(* auth.ml — user registration, login, session tokens.
   All data stored as JSON files under the storage root. *)

type user = {
  id : string;
  email : string;
  password_hash : string;
  name : string;
  color : string;
  avatar : string option;
  created_at : float;
  updated_at : float;
}

type session = {
  token : string;
  user_id : string;
  created_at : float;
  expires_at : float;
}

(* 7-day session expiry *)
let session_ttl = 7.0 *. 24.0 *. 3600.0

(* ── Token generation ──────────────────────────────────────────────── *)

let generate_token () =
  let buf = Bytes.create 32 in
  let ic = open_in_bin "/dev/urandom" in
  (try really_input ic buf 0 32
   with e ->
     close_in ic;
     raise e);
  close_in ic;
  Bytes.fold_left
    (fun acc c -> acc ^ Printf.sprintf "%02x" (Char.code c))
    "" buf

let new_uuid () =
  let rng = Random.State.make_self_init () in
  Uuidm.v4_gen rng () |> Uuidm.to_string

(* ── JSON helpers ─────────────────────────────────────────────────── *)

let user_of_json j =
  let open Yojson.Safe.Util in
  {
    id = j |> member "id" |> to_string;
    email = j |> member "email" |> to_string;
    password_hash = j |> member "password_hash" |> to_string;
    name = j |> member "name" |> to_string;
    color = j |> member "color" |> to_string_option |> Option.value ~default:"#4f46e5";
    avatar = j |> member "avatar" |> to_string_option;
    created_at = j |> member "created_at" |> to_float;
    updated_at = j |> member "updated_at" |> to_float;
  }

let user_to_json u =
  `Assoc
    [
      ("id", `String u.id);
      ("email", `String u.email);
      ("name", `String u.name);
      ("color", `String u.color);
      ("avatar", match u.avatar with Some a -> `String a | None -> `Null);
      ("created_at", `Float u.created_at);
      ("updated_at", `Float u.updated_at);
    ]

(* Includes password_hash — only stored to disk, never sent to client *)
let user_to_storage_json u =
  `Assoc
    [
      ("id", `String u.id);
      ("email", `String u.email);
      ("password_hash", `String u.password_hash);
      ("name", `String u.name);
      ("color", `String u.color);
      ("avatar", match u.avatar with Some a -> `String a | None -> `Null);
      ("created_at", `Float u.created_at);
      ("updated_at", `Float u.updated_at);
    ]

let session_of_json j =
  let open Yojson.Safe.Util in
  {
    token = j |> member "token" |> to_string;
    user_id = j |> member "user_id" |> to_string;
    created_at = j |> member "created_at" |> to_float;
    expires_at = j |> member "expires_at" |> to_float;
  }

let session_to_json s =
  `Assoc
    [
      ("token", `String s.token);
      ("user_id", `String s.user_id);
      ("created_at", `Float s.created_at);
      ("expires_at", `Float s.expires_at);
    ]

(* ── Persistence ──────────────────────────────────────────────────── *)

let load_user root user_id =
  match%lwt Store.read_bytes (Store.user_profile_path root user_id) with
  | None -> Lwt.return_none
  | Some s ->
    Lwt.catch
      (fun () ->
        let u = s |> Yojson.Safe.from_string |> user_of_json in
        Lwt.return_some u)
      (fun _ -> Lwt.return_none)

let save_user root user =
  let json = user |> user_to_storage_json |> Yojson.Safe.to_string in
  Store.write_bytes (Store.user_profile_path root user.id) json

(** Scan users/ dir to find a user by email — O(n) but n is small. *)
let find_by_email root email =
  let users_dir = root ^ "/users" in
  Lwt.catch
    (fun () ->
      let%lwt handle = Lwt_unix.opendir users_dir in
      let result = ref None in
      let rec loop () =
        Lwt.catch
          (fun () ->
            let%lwt entry = Lwt_unix.readdir handle in
            if entry <> "." && entry <> ".." && !result = None then begin
              match%lwt load_user root entry with
              | Some u when String.lowercase_ascii u.email = String.lowercase_ascii email ->
                result := Some u;
                loop ()
              | _ -> loop ()
            end else loop ())
          (function
            | End_of_file ->
              let%lwt () = Lwt_unix.closedir handle in
              Lwt.return_unit
            | e -> Lwt.fail e)
      in
      let%lwt () = loop () in
      Lwt.return !result)
    (fun _ -> Lwt.return_none)

(* ── Sessions ──────────────────────────────────────────────────── *)

let load_sessions root user_id =
  match%lwt Store.read_bytes (Store.user_sessions_path root user_id) with
  | None -> Lwt.return []
  | Some s ->
    Lwt.catch
      (fun () ->
        let arr = Yojson.Safe.from_string s in
        let sessions =
          Yojson.Safe.Util.to_list arr |> List.map session_of_json
        in
        Lwt.return sessions)
      (fun _ -> Lwt.return [])

let save_sessions root user_id sessions =
  let json =
    `List (List.map session_to_json sessions) |> Yojson.Safe.to_string
  in
  Store.write_bytes (Store.user_sessions_path root user_id) json

let create_session root user_id =
  let now = Unix.gettimeofday () in
  let s =
    {
      token = generate_token ();
      user_id;
      created_at = now;
      expires_at = now +. session_ttl;
    }
  in
  let%lwt existing = load_sessions root user_id in
  (* prune expired *)
  let active =
    List.filter (fun s -> s.expires_at > now) existing
  in
  let%lwt () = save_sessions root user_id (s :: active) in
  Lwt.return s

let validate_session root token =
  let now = Unix.gettimeofday () in
  (* Token format: 64 hex chars. We can't know user_id without scanning.
     For performance, keep a in-memory token→user_id map built at startup. *)
  (* Simple approach: scan all users. For small deployments this is fine.
     Production improvement: keep an index file. *)
  let users_dir = root ^ "/users" in
  Lwt.catch
    (fun () ->
      let%lwt handle = Lwt_unix.opendir users_dir in
      let result = ref None in
      let rec loop () =
        Lwt.catch
          (fun () ->
            let%lwt entry = Lwt_unix.readdir handle in
            if entry <> "." && entry <> ".." && !result = None then begin
              match%lwt load_sessions root entry with
              | sessions -> (
                match
                  List.find_opt
                    (fun s -> s.token = token && s.expires_at > now)
                    sessions
                with
                | Some _s ->
                  (match%lwt load_user root entry with
                  | Some u -> result := Some u
                  | None -> ());
                  loop ()
                | None -> loop ())
            end else loop ())
          (function
            | End_of_file ->
              let%lwt () = Lwt_unix.closedir handle in
              Lwt.return_unit
            | e -> Lwt.fail e)
      in
      let%lwt () = loop () in
      Lwt.return !result)
    (fun _ -> Lwt.return_none)

let delete_session root token =
  let now = Unix.gettimeofday () in
  let users_dir = root ^ "/users" in
  Lwt.catch
    (fun () ->
      let%lwt handle = Lwt_unix.opendir users_dir in
      let rec loop () =
        Lwt.catch
          (fun () ->
            let%lwt entry = Lwt_unix.readdir handle in
            if entry <> "." && entry <> ".." then begin
              let%lwt sessions = load_sessions root entry in
              let remaining =
                List.filter
                  (fun s -> s.token <> token && s.expires_at > now)
                  sessions
              in
              if List.length remaining < List.length sessions then
                let%lwt () = save_sessions root entry remaining in
                Lwt_unix.closedir handle
              else loop ()
            end else loop ())
          (function
            | End_of_file ->
              let%lwt () = Lwt_unix.closedir handle in
              Lwt.return_unit
            | e -> Lwt.fail e)
      in
      loop ())
    (fun _ -> Lwt.return_unit)

(* ── Public API ───────────────────────────────────────────────────── *)

let register root ~email ~password ~name =
  match%lwt find_by_email root email with
  | Some _ -> Lwt.return_error "email_taken"
  | None ->
    let id = new_uuid () in
    let hash = Bcrypt.hash password |> Bcrypt.string_of_hash in
    let now = Unix.gettimeofday () in
    let user =
      {
        id;
        email;
        password_hash = hash;
        name;
        color = "#4f46e5";
        avatar = None;
        created_at = now;
        updated_at = now;
      }
    in
    let%lwt () = save_user root user in
    let%lwt session = create_session root id in
    Lwt.return_ok (user, session)

let login root ~email ~password =
  match%lwt find_by_email root email with
  | None -> Lwt.return_none
  | Some user ->
    let hash = Bcrypt.hash_of_string user.password_hash in
    if Bcrypt.verify password hash then
      let%lwt session = create_session root user.id in
      Lwt.return_some (user, session)
    else Lwt.return_none

let update_profile root user_id ~name ~color ~avatar =
  match%lwt load_user root user_id with
  | None -> Lwt.return_none
  | Some user ->
    let updated =
      {
        user with
        name = Option.value ~default:user.name name;
        color = Option.value ~default:user.color color;
        avatar = (match avatar with Some _ -> avatar | None -> user.avatar);
        updated_at = Unix.gettimeofday ();
      }
    in
    let%lwt () = save_user root updated in
    Lwt.return_some updated

let update_password root user_id ~current_password ~new_password =
  match%lwt load_user root user_id with
  | None -> Lwt.return_error "not_found"
  | Some user ->
    let hash = Bcrypt.hash_of_string user.password_hash in
    if not (Bcrypt.verify current_password hash) then
      Lwt.return_error "wrong_password"
    else
      let new_hash = Bcrypt.hash new_password |> Bcrypt.string_of_hash in
      let updated =
        { user with password_hash = new_hash; updated_at = Unix.gettimeofday () }
      in
      let%lwt () = save_user root updated in
      Lwt.return_ok updated

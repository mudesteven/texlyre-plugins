(* store.ml — raw filesystem operations on a root path.
   Works identically whether root is a local SSD or a FUSE mount. *)

(** Remove any ".." or absolute-path tricks from a relative path. *)
let sanitize_path path =
  let parts = String.split_on_char '/' path in
  let safe =
    List.filter_map
      (fun p ->
        match p with
        | "" | "." | ".." -> None
        | _ -> Some p)
      parts
  in
  String.concat "/" safe

let ensure_dir path =
  let parts = String.split_on_char '/' path in
  let rec aux acc = function
    | [] -> Lwt.return_unit
    | part :: rest ->
      let p = if acc = "" then part else acc ^ "/" ^ part in
      let%lwt () =
        if p = "" then Lwt.return_unit
        else
          Lwt.catch
            (fun () -> Lwt_unix.mkdir p 0o755)
            (function
              | Unix.Unix_error (Unix.EEXIST, _, _) -> Lwt.return_unit
              | e -> Lwt.fail e)
      in
      aux p rest
  in
  aux "" parts

let read_bytes path =
  Lwt.catch
    (fun () ->
      Lwt_io.with_file ~mode:Lwt_io.input path (fun ic ->
          let%lwt s = Lwt_io.read ic in
          Lwt.return_some s))
    (fun _ -> Lwt.return_none)

let write_bytes path content =
  let%lwt () = ensure_dir (Filename.dirname path) in
  Lwt_io.with_file ~mode:Lwt_io.output path (fun oc ->
      Lwt_io.write oc content)

let delete_path path =
  Lwt.catch
    (fun () -> Lwt_unix.unlink path)
    (fun _ -> Lwt.return_unit)

let file_mtime path =
  Lwt.catch
    (fun () ->
      let%lwt stat = Lwt_unix.stat path in
      Lwt.return_some stat.Unix.st_mtime)
    (fun _ -> Lwt.return_none)

(** Recursively walk a directory; returns (absolute_path, mtime) list. *)
let rec walk dir =
  Lwt.catch
    (fun () ->
      let%lwt handle = Lwt_unix.opendir dir in
      let acc = ref [] in
      let rec loop () =
        Lwt.catch
          (fun () ->
            let%lwt entry = Lwt_unix.readdir handle in
            if entry <> "." && entry <> ".." then begin
              let full = Filename.concat dir entry in
              let%lwt stat =
                Lwt.catch
                  (fun () ->
                    let%lwt s = Lwt_unix.lstat full in
                    Lwt.return_some s)
                  (fun _ -> Lwt.return_none)
              in
              (match stat with
              | Some s -> (
                match s.Unix.st_kind with
                | Unix.S_DIR ->
                  let%lwt sub = walk full in
                  acc := sub @ !acc;
                  loop ()
                | Unix.S_REG ->
                  acc := (full, s.Unix.st_mtime, s.Unix.st_size) :: !acc;
                  loop ()
                | _ -> loop ())
              | None -> loop ())
            end else loop ())
          (function
            | End_of_file ->
              let%lwt () = Lwt_unix.closedir handle in
              Lwt.return_unit
            | e -> Lwt.fail e)
      in
      let%lwt () = loop () in
      Lwt.return !acc)
    (fun _ -> Lwt.return [])

(** Copy src → dst, creating parent dirs as needed. *)
let copy_file src dst =
  Lwt.catch
    (fun () ->
      match%lwt read_bytes src with
      | None -> Lwt.return_unit
      | Some content -> write_bytes dst content)
    (fun _ -> Lwt.return_unit)

(* ── Path helpers ─────────────────────────────────────────────────── *)

let user_profile_path root user_id =
  Printf.sprintf "%s/users/%s/profile.json" root (sanitize_path user_id)

let user_sessions_path root user_id =
  Printf.sprintf "%s/users/%s/sessions.json" root (sanitize_path user_id)

let projects_dir root = root ^ "/projects"

let project_meta_path root project_id =
  Printf.sprintf "%s/projects/%s/meta.json" root (sanitize_path project_id)

let project_files_dir root project_id =
  Printf.sprintf "%s/projects/%s/files" root (sanitize_path project_id)

let project_file_path root project_id rel_path =
  Printf.sprintf "%s/projects/%s/files/%s" root
    (sanitize_path project_id)
    (sanitize_path rel_path)

(** List all regular files under a project's files dir as relative paths. *)
let list_project_files root project_id =
  let base = project_files_dir root project_id in
  let base_len = String.length base + 1 in
  let%lwt all = walk base in
  Lwt.return
    (List.map
       (fun (abs, mtime, size) ->
         let rel =
           if String.length abs > base_len then
             String.sub abs base_len (String.length abs - base_len)
           else abs
         in
         (rel, mtime, size))
       all)

(** List all project IDs under root/projects/ *)
let list_project_ids root =
  let dir = projects_dir root in
  Lwt.catch
    (fun () ->
      let%lwt handle = Lwt_unix.opendir dir in
      let acc = ref [] in
      let rec loop () =
        Lwt.catch
          (fun () ->
            let%lwt entry = Lwt_unix.readdir handle in
            if entry <> "." && entry <> ".." then begin
              acc := entry :: !acc;
              loop ()
            end else loop ())
          (function
            | End_of_file ->
              let%lwt () = Lwt_unix.closedir handle in
              Lwt.return_unit
            | e -> Lwt.fail e)
      in
      let%lwt () = loop () in
      Lwt.return !acc)
    (fun _ -> Lwt.return [])

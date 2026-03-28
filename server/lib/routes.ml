(* routes.ml — Dream HTTP + WebSocket handlers *)

(* ── Helpers ──────────────────────────────────────────────────────── *)

let json_response ?(status = `OK) body =
  Dream.respond ~status
    ~headers:[ ("Content-Type", "application/json") ]
    body

let err ?(status = `Bad_Request) msg =
  json_response ~status (Printf.sprintf {|{"error":"%s"}|} msg)

let ok_json j = json_response (Yojson.Safe.to_string j)

let bearer_token req =
  match Dream.header req "Authorization" with
  | Some h when String.length h > 7 && String.sub h 0 7 = "Bearer " ->
    Some (String.sub h 7 (String.length h - 7))
  | _ -> None

(** Middleware: validate Bearer token, attach user to request *)
let user_field : Auth.user Dream.field = Dream.new_field ()

let require_auth root handler req =
  match bearer_token req with
  | None -> err ~status:`Unauthorized "missing_token"
  | Some token -> (
    match%lwt Auth.validate_session root token with
    | None -> err ~status:`Unauthorized "invalid_token"
    | Some user ->
      Dream.set_field req user_field user;
      handler req)

let get_user req =
  match Dream.field req user_field with
  | Some u -> u
  | None -> failwith "user field not set"

(* Base64 encode/decode for binary file content in WS messages *)
let base64_encode s =
  let b = Buffer.create (String.length s * 4 / 3 + 4) in
  let enc = Base64.encode_exn s in
  Buffer.add_string b enc;
  Buffer.contents b

let base64_decode s =
  match Base64.decode s with
  | Ok v -> v
  | Error (`Msg m) -> failwith ("base64 decode: " ^ m)

(* ── CORS middleware ──────────────────────────────────────────────── *)

let cors_middleware allowed_origins handler req =
  let origin = Dream.header req "Origin" |> Option.value ~default:"" in
  let allowed = List.mem origin allowed_origins in
  if Dream.method_ req = `OPTIONS then begin
    Dream.respond ~status:`No_Content
      ~headers:
        (if allowed then
           [
             ("Access-Control-Allow-Origin", origin);
             ("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
             ("Access-Control-Allow-Headers", "Content-Type,Authorization");
             ("Access-Control-Max-Age", "86400");
           ]
         else [])
      ""
  end else begin
    let%lwt resp = handler req in
    if allowed then begin
      Dream.add_header resp "Access-Control-Allow-Origin" origin;
      Dream.add_header resp "Access-Control-Allow-Credentials" "true"
    end;
    Lwt.return resp
  end

(* ── Auth handlers ────────────────────────────────────────────────── *)

let handle_register root req =
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      let j = Yojson.Safe.from_string body in
      let open Yojson.Safe.Util in
      let email = j |> member "email" |> to_string in
      let password = j |> member "password" |> to_string in
      let name = j |> member "name" |> to_string in
      match%lwt Auth.register root ~email ~password ~name with
      | Error "email_taken" -> err "email_taken"
      | Error e -> err e
      | Ok (user, session) ->
        ok_json
          (`Assoc
            [
              ("token", `String session.token);
              ("user", Auth.user_to_json user);
            ]))
    (fun _ -> err "invalid_body")

let handle_login root req =
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      let j = Yojson.Safe.from_string body in
      let open Yojson.Safe.Util in
      let email = j |> member "email" |> to_string in
      let password = j |> member "password" |> to_string in
      match%lwt Auth.login root ~email ~password with
      | None -> err ~status:`Unauthorized "invalid_credentials"
      | Some (user, session) ->
        ok_json
          (`Assoc
            [
              ("token", `String session.token);
              ("user", Auth.user_to_json user);
            ]))
    (fun _ -> err "invalid_body")

let handle_logout root req =
  match bearer_token req with
  | None -> err ~status:`Unauthorized "missing_token"
  | Some token ->
    let%lwt () = Auth.delete_session root token in
    json_response {|{"ok":true}|}

let handle_me _root req =
  let user = get_user req in
  ok_json (Auth.user_to_json user)

let handle_update_profile root req =
  let user = get_user req in
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      let j = Yojson.Safe.from_string body in
      let open Yojson.Safe.Util in
      let name = j |> member "name" |> to_string_option in
      let color = j |> member "color" |> to_string_option in
      let avatar = j |> member "avatar" |> to_string_option in
      match%lwt Auth.update_profile root user.id ~name ~color ~avatar with
      | None -> err ~status:`Not_Found "user_not_found"
      | Some updated -> ok_json (Auth.user_to_json updated))
    (fun _ -> err "invalid_body")

let handle_update_password root req =
  let user = get_user req in
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      let j = Yojson.Safe.from_string body in
      let open Yojson.Safe.Util in
      let current = j |> member "current_password" |> to_string in
      let next = j |> member "new_password" |> to_string in
      match%lwt Auth.update_password root user.id ~current_password:current ~new_password:next with
      | Error "wrong_password" -> err ~status:`Unauthorized "wrong_password"
      | Error e -> err e
      | Ok updated -> ok_json (Auth.user_to_json updated))
    (fun _ -> err "invalid_body")

(* ── Project handlers ─────────────────────────────────────────────── *)

let project_meta_to_json root project_id =
  match%lwt Store.read_bytes (Store.project_meta_path root project_id) with
  | None -> Lwt.return_none
  | Some s ->
    Lwt.catch
      (fun () -> Lwt.return_some (Yojson.Safe.from_string s))
      (fun _ -> Lwt.return_none)

let handle_list_projects root req =
  let user = get_user req in
  let%lwt ids = Store.list_project_ids root in
  let%lwt metas =
    Lwt_list.filter_map_s
      (fun id ->
        match%lwt project_meta_to_json root id with
        | None -> Lwt.return_none
        | Some j ->
          let open Yojson.Safe.Util in
          let owner = j |> member "owner_id" |> to_string_option in
          if owner = Some user.id then Lwt.return_some j
          else Lwt.return_none)
      ids
  in
  ok_json (`List metas)

let handle_create_project root req =
  let user = get_user req in
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      let j = Yojson.Safe.from_string body in
      let open Yojson.Safe.Util in
      let title = j |> member "title" |> to_string in
      let proj_type =
        j |> member "type" |> to_string_option |> Option.value ~default:"typst"
      in
      let tags =
        j |> member "tags" |> to_list |> List.map to_string
      in
      let id =
        Auth.new_uuid ()
      in
      let now = Unix.gettimeofday () in
      let meta =
        `Assoc
          [
            ("id", `String id);
            ("title", `String title);
            ("type", `String proj_type);
            ("tags", `List (List.map (fun t -> `String t) tags));
            ("owner_id", `String user.id);
            ("created_at", `Float now);
            ("updated_at", `Float now);
          ]
      in
      let%lwt () =
        Store.write_bytes
          (Store.project_meta_path root id)
          (Yojson.Safe.to_string meta)
      in
      ok_json meta)
    (fun e ->
      Dream.log "create_project error: %s" (Printexc.to_string e);
      err "invalid_body")

let handle_get_project root req =
  let project_id = Dream.param req "project_id" in
  match%lwt project_meta_to_json root project_id with
  | None -> err ~status:`Not_Found "not_found"
  | Some j -> ok_json j

let handle_update_project root req =
  let project_id = Dream.param req "project_id" in
  let%lwt body = Dream.body req in
  Lwt.catch
    (fun () ->
      match%lwt project_meta_to_json root project_id with
      | None -> err ~status:`Not_Found "not_found"
      | Some existing ->
        let patch = Yojson.Safe.from_string body in
        let open Yojson.Safe.Util in
        let updated =
          match existing with
          | `Assoc fields ->
            let fields =
              List.map
                (fun (k, v) ->
                  match k with
                  | "title" -> (
                    match patch |> member "title" |> to_string_option with
                    | Some t -> (k, `String t)
                    | None -> (k, v))
                  | "tags" -> (
                    try
                      let tags =
                        patch |> member "tags" |> to_list
                        |> List.map to_string
                      in
                      (k, `List (List.map (fun t -> `String t) tags))
                    with _ -> (k, v))
                  | "updated_at" -> (k, `Float (Unix.gettimeofday ()))
                  | _ -> (k, v))
                fields
            in
            `Assoc fields
          | _ -> existing
        in
        let%lwt () =
          Store.write_bytes
            (Store.project_meta_path root project_id)
            (Yojson.Safe.to_string updated)
        in
        ok_json updated)
    (fun _ -> err "invalid_body")

let handle_delete_project root req =
  let project_id = Dream.param req "project_id" in
  let meta_path = Store.project_meta_path root project_id in
  let%lwt () = Store.delete_path meta_path in
  (* Leave files in place intentionally — FUSE will sync deletion separately *)
  json_response {|{"ok":true}|}

(* ── File handlers ────────────────────────────────────────────────── *)

let handle_list_files root req =
  let project_id = Dream.param req "project_id" in
  let%lwt files = Store.list_project_files root project_id in
  let items =
    List.map
      (fun (path, mtime, size) ->
        `Assoc
          [
            ("path", `String path);
            ("modified", `Float mtime);
            ("size", `Int size);
          ])
      files
  in
  ok_json (`List items)

let handle_get_file root req =
  let project_id = Dream.param req "project_id" in
  let rel_path = Dream.param req "**" in
  let abs = Store.project_file_path root project_id rel_path in
  match%lwt Store.read_bytes abs with
  | None -> err ~status:`Not_Found "not_found"
  | Some content ->
    let mime =
      match Filename.extension rel_path with
      | ".pdf" -> "application/pdf"
      | ".png" -> "image/png"
      | ".jpg" | ".jpeg" -> "image/jpeg"
      | ".gif" -> "image/gif"
      | ".svg" -> "image/svg+xml"
      | _ -> "application/octet-stream"
    in
    Dream.respond ~headers:[ ("Content-Type", mime) ] content

let handle_put_file ?(fuse_root = None) local_root req =
  let project_id = Dream.param req "project_id" in
  let rel_path = Dream.param req "**" in
  let%lwt body = Dream.body req in
  let abs = Store.project_file_path local_root project_id rel_path in
  let%lwt () = Store.write_bytes abs body in
  (* Mirror to FUSE asynchronously *)
  (match fuse_root with
  | Some fr ->
    let rel = Printf.sprintf "projects/%s/files/%s" project_id rel_path in
    Syncer.mirror_to_fuse ~local_root ~fuse_root:fr rel
  | None -> ());
  let%lwt mtime = Store.file_mtime abs in
  ok_json
    (`Assoc [ ("modified", `Float (Option.value ~default:0.0 mtime)) ])

let handle_delete_file ?(fuse_root = None) local_root req =
  let project_id = Dream.param req "project_id" in
  let rel_path = Dream.param req "**" in
  let abs = Store.project_file_path local_root project_id rel_path in
  let%lwt () = Store.delete_path abs in
  (match fuse_root with
  | Some fr ->
    let dst = Store.project_file_path fr project_id rel_path in
    Lwt.async (fun () ->
        Lwt.catch (fun () -> Store.delete_path dst) (fun _ -> Lwt.return_unit))
  | None -> ());
  json_response {|{"ok":true}|}

(* ── WebSocket handler ────────────────────────────────────────────── *)

let handle_ws root req =
  (* Token passed as ?token= query param because WS JS API can't set headers *)
  let token_opt = Dream.query req "token" in
  match token_opt with
  | None -> err ~status:`Unauthorized "missing_token"
  | Some token -> (
    match%lwt Auth.validate_session root token with
    | None -> err ~status:`Unauthorized "invalid_token"
    | Some user ->
      Dream.websocket ~close:false (fun ws ->
          let conn_id = Auth.new_uuid () in
          let conn : Hub.conn =
            { id = conn_id; user_id = user.id; ws; subscriptions = [] }
          in
          let%lwt () = Hub.add conn in
          let rec loop () =
            match%lwt Dream.receive ws with
            | None ->
              (* Client disconnected *)
              Hub.remove conn_id
            | Some msg -> (
              Lwt.catch
                (fun () ->
                  let j = Yojson.Safe.from_string msg in
                  let open Yojson.Safe.Util in
                  let typ = j |> member "type" |> to_string in
                  match typ with
                  | "ping" ->
                    let%lwt () = Dream.send ws {|{"type":"pong"}|} in
                    loop ()
                  | "subscribe" ->
                    let project_id = j |> member "project_id" |> to_string in
                    let%lwt () = Hub.subscribe conn_id project_id in
                    (* Send current file listing so client can diff *)
                    let%lwt files =
                      Store.list_project_files root project_id
                    in
                    let items =
                      List.map
                        (fun (path, mtime, size) ->
                          `Assoc
                            [
                              ("path", `String path);
                              ("modified", `Float mtime);
                              ("size", `Int size);
                            ])
                        files
                    in
                    let resp =
                      `Assoc
                        [
                          ("type", `String "subscribed");
                          ("project_id", `String project_id);
                          ("files", `List items);
                        ]
                      |> Yojson.Safe.to_string
                    in
                    let%lwt () = Dream.send ws resp in
                    loop ()
                  | "unsubscribe" ->
                    let project_id = j |> member "project_id" |> to_string in
                    let%lwt () = Hub.unsubscribe conn_id project_id in
                    loop ()
                  | "file_write" ->
                    let project_id = j |> member "project_id" |> to_string in
                    let rel_path = j |> member "path" |> to_string in
                    let content_b64 = j |> member "content" |> to_string in
                    let content = base64_decode content_b64 in
                    let abs = Store.project_file_path root project_id rel_path in
                    let%lwt () = Store.write_bytes abs content in
                    (* Broadcast to other subscribers *)
                    let broadcast_msg =
                      `Assoc
                        [
                          ("type", `String "file_changed");
                          ("project_id", `String project_id);
                          ("path", `String rel_path);
                          ("content", `String content_b64);
                          ("by", `String user.id);
                        ]
                      |> Yojson.Safe.to_string
                    in
                    let%lwt () =
                      Hub.broadcast ~project_id ~except:conn_id broadcast_msg
                    in
                    loop ()
                  | "file_delete" ->
                    let project_id = j |> member "project_id" |> to_string in
                    let rel_path = j |> member "path" |> to_string in
                    let abs = Store.project_file_path root project_id rel_path in
                    let%lwt () = Store.delete_path abs in
                    let broadcast_msg =
                      `Assoc
                        [
                          ("type", `String "file_deleted");
                          ("project_id", `String project_id);
                          ("path", `String rel_path);
                        ]
                      |> Yojson.Safe.to_string
                    in
                    let%lwt () =
                      Hub.broadcast ~project_id ~except:conn_id broadcast_msg
                    in
                    loop ()
                  | _ -> loop ())
                (fun _ -> loop ()))
          in
          loop ()) req)

(* ── Router ───────────────────────────────────────────────────────── *)

let router (cfg : Config.t) =
  let root = cfg.local_root in
  let fuse = cfg.fuse_root in

  (* Start FUSE→LOCAL sync if configured *)
  (match fuse with
  | Some fr ->
    Syncer.start ~local_root:root ~fuse_root:fr
      ~interval:cfg.fuse_poll_interval
      ~on_external_change:(fun ~project_id ~rel_path ~content ->
        let b64 = base64_encode content in
        let msg =
          `Assoc
            [
              ("type", `String "file_changed");
              ("project_id", `String project_id);
              ("path", `String rel_path);
              ("content", `String b64);
              ("by", `String "external");
            ]
          |> Yojson.Safe.to_string
        in
        Hub.broadcast ~project_id msg)
  | None -> ());

  let auth_wrap handler req = require_auth root handler req in

  Dream.router
    [
      Dream.options "/**" (fun _ -> Dream.respond ~status:`No_Content "");

      (* Auth — no token required *)
      Dream.post "/auth/register" (handle_register root);
      Dream.post "/auth/login" (handle_login root);
      Dream.post "/auth/logout" (handle_logout root);

      (* Auth — token required *)
      Dream.get "/auth/me" (auth_wrap (handle_me root));
      Dream.put "/auth/profile" (auth_wrap (handle_update_profile root));
      Dream.put "/auth/password" (auth_wrap (handle_update_password root));

      (* Projects *)
      Dream.get "/projects" (auth_wrap (handle_list_projects root));
      Dream.post "/projects" (auth_wrap (handle_create_project root));
      Dream.get "/projects/:project_id" (auth_wrap (handle_get_project root));
      Dream.put "/projects/:project_id" (auth_wrap (handle_update_project root));
      Dream.delete "/projects/:project_id" (auth_wrap (handle_delete_project root));

      (* Files — glob param captures the rest of the path *)
      Dream.get "/projects/:project_id/files/**"
        (auth_wrap (handle_list_files root));
      (* Note: Dream uses ** for glob; list endpoint ignores it *)
      Dream.get "/projects/:project_id/file/**"
        (auth_wrap (handle_get_file root));
      Dream.put "/projects/:project_id/file/**"
        (auth_wrap (handle_put_file ~fuse_root:fuse root));
      Dream.delete "/projects/:project_id/file/**"
        (auth_wrap (handle_delete_file ~fuse_root:fuse root));

      (* WebSocket *)
      Dream.get "/ws" (handle_ws root);
    ]

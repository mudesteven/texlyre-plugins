(* syncer.ml — Dual-path background sync.
   LOCAL_ROOT is the fast primary store.
   FUSE_ROOT is the google-drive-ocamlfuse mount (optional).

   Two sync directions:
   1. LOCAL → FUSE  (write-through, fires after every client write)
   2. FUSE → LOCAL  (poll-based, detects changes from other devices via Drive) *)

(* Per-path mtime table used to detect external FUSE changes *)
let fuse_mtimes : (string, float) Hashtbl.t = Hashtbl.create 128
let fuse_mtimes_mutex = Lwt_mutex.create ()

(* ── LOCAL → FUSE ─────────────────────────────────────────────────── *)

(** Mirror a single file from local_root to fuse_root.
    Called immediately after a client write; errors are silently ignored
    so FUSE latency never blocks the API response. *)
let mirror_to_fuse ~local_root ~fuse_root rel_path =
  let src = Filename.concat local_root rel_path in
  let dst = Filename.concat fuse_root rel_path in
  Lwt.async (fun () ->
      Lwt.catch
        (fun () -> Store.copy_file src dst)
        (fun _ -> Lwt.return_unit))

(* ── FUSE → LOCAL poll ────────────────────────────────────────────── *)

(** Parse a fuse-rooted absolute path into (project_id, relative_file_path).
    Expects: {fuse_root}/projects/{project_id}/files/{...} *)
let parse_project_path fuse_root abs_path =
  let prefix = fuse_root ^ "/projects/" in
  let plen = String.length prefix in
  if String.length abs_path > plen
     && String.sub abs_path 0 plen = prefix
  then begin
    let rest = String.sub abs_path plen (String.length abs_path - plen) in
    match String.split_on_char '/' rest with
    | project_id :: "files" :: file_parts when file_parts <> [] ->
      let rel = String.concat "/" file_parts in
      Some (project_id, rel)
    | _ -> None
  end else None

let poll_fuse_once ~local_root ~fuse_root ~on_external_change =
  let%lwt all = Store.walk fuse_root in
  Lwt_list.iter_s
    (fun (abs_path, mtime, _size) ->
      let%lwt prev =
        Lwt_mutex.with_lock fuse_mtimes_mutex (fun () ->
            Lwt.return (Hashtbl.find_opt fuse_mtimes abs_path))
      in
      let is_new_or_changed =
        match prev with
        | None -> true
        | Some t -> mtime > t +. 0.5 (* 0.5s tolerance *)
      in
      if is_new_or_changed then begin
        let%lwt () =
          Lwt_mutex.with_lock fuse_mtimes_mutex (fun () ->
              Hashtbl.replace fuse_mtimes abs_path mtime;
              Lwt.return_unit)
        in
        (* Only propagate project files (not user profiles) *)
        match parse_project_path fuse_root abs_path with
        | None -> Lwt.return_unit
        | Some (project_id, rel_path) ->
          let local_path = Store.project_file_path local_root project_id rel_path in
          let%lwt () =
            Lwt.catch
              (fun () -> Store.copy_file abs_path local_path)
              (fun _ -> Lwt.return_unit)
          in
          (* Read new content to broadcast to WS clients *)
          (match%lwt Store.read_bytes local_path with
          | None -> Lwt.return_unit
          | Some content ->
            on_external_change ~project_id ~rel_path ~content)
      end else Lwt.return_unit)
    all

(** Seed fuse_mtimes with current state so existing files don't trigger
    false "external change" events on startup. *)
let seed_fuse_mtimes fuse_root =
  let%lwt all = Store.walk fuse_root in
  Lwt_mutex.with_lock fuse_mtimes_mutex (fun () ->
      List.iter
        (fun (abs_path, mtime, _) ->
          Hashtbl.replace fuse_mtimes abs_path mtime)
        all;
      Lwt.return_unit)

(* ── Entry point ──────────────────────────────────────────────────── *)

(** Start the background FUSE→LOCAL polling loop.
    [on_external_change] is called for each file that changed externally;
    the caller (routes.ml) broadcasts it over WebSocket. *)
let start ~local_root ~fuse_root ~interval ~on_external_change =
  Lwt.async (fun () ->
      let%lwt () = seed_fuse_mtimes fuse_root in
      let rec loop () =
        let%lwt () = Lwt_unix.sleep interval in
        let%lwt () =
          Lwt.catch
            (fun () ->
              poll_fuse_once ~local_root ~fuse_root ~on_external_change)
            (fun _ -> Lwt.return_unit)
        in
        loop ()
      in
      loop ())

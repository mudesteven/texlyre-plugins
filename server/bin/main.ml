(* main.ml — entry point *)

let () =
  let cfg = Config.load () in
  Dream.log "TeXlyre sync server";
  Dream.log "  LOCAL_ROOT: %s" cfg.local_root;
  (match cfg.fuse_root with
  | Some fr -> Dream.log "  FUSE_ROOT:  %s (poll every %.0fs)" fr cfg.fuse_poll_interval
  | None -> Dream.log "  FUSE_ROOT:  (not configured)");
  Dream.log "  PORT: %d" cfg.port;

  (* Ensure local root exists *)
  (try Unix.mkdir cfg.local_root 0o755 with Unix.Unix_error (Unix.EEXIST, _, _) -> ());

  Dream.run ~port:cfg.port ~tls:false
  @@ Dream.logger
  @@ (fun handler req -> Routes.cors_middleware cfg.allowed_origins handler req)
  @@ Routes.router cfg

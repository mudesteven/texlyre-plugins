(* config.ml — reads configuration from environment variables *)

type t = {
  local_root : string;
  (** Primary fast storage. All reads/writes land here immediately. *)
  fuse_root : string option;
  (** Optional FUSE-mounted Google Drive path. Background sync target. *)
  port : int;
  secret : string;
  (** Used to sign session tokens (HMAC not needed here; just kept for
      future JWT migration). *)
  allowed_origins : string list;
  local_sync_interval : float;
  (** Seconds between LOCAL → FUSE mirror writes (default 2). *)
  fuse_poll_interval : float;
  (** Seconds between FUSE → LOCAL polls for external changes (default 10). *)
}

let get_env key default =
  match Sys.getenv_opt key with
  | Some v when String.length v > 0 -> v
  | _ -> default

let load () =
  {
    local_root = get_env "LOCAL_ROOT" "/var/lib/texlyre";
    fuse_root =
      (match Sys.getenv_opt "FUSE_ROOT" with
      | Some v when String.length v > 0 -> Some v
      | _ -> None);
    port = get_env "PORT" "7331" |> int_of_string;
    secret = get_env "SECRET" "change-me-in-production";
    allowed_origins =
      get_env "ALLOWED_ORIGINS" "http://localhost:5173"
      |> String.split_on_char ',';
    local_sync_interval =
      get_env "LOCAL_SYNC_INTERVAL" "2" |> float_of_string;
    fuse_poll_interval =
      get_env "FUSE_POLL_INTERVAL" "10" |> float_of_string;
  }

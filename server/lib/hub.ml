(* hub.ml — WebSocket connection registry and broadcast.
   All state is in-memory; connections are re-established on reconnect. *)

type conn = {
  id : string;
  user_id : string;
  ws : Dream.websocket;
  mutable subscriptions : string list; (* project_ids *)
}

let connections : (string, conn) Hashtbl.t = Hashtbl.create 16
let mutex = Lwt_mutex.create ()

let add conn =
  Lwt_mutex.with_lock mutex (fun () ->
      Hashtbl.replace connections conn.id conn;
      Lwt.return_unit)

let remove id =
  Lwt_mutex.with_lock mutex (fun () ->
      Hashtbl.remove connections id;
      Lwt.return_unit)

let subscribe conn_id project_id =
  Lwt_mutex.with_lock mutex (fun () ->
      (match Hashtbl.find_opt connections conn_id with
      | Some c ->
        if not (List.mem project_id c.subscriptions) then
          c.subscriptions <- project_id :: c.subscriptions
      | None -> ());
      Lwt.return_unit)

let unsubscribe conn_id project_id =
  Lwt_mutex.with_lock mutex (fun () ->
      (match Hashtbl.find_opt connections conn_id with
      | Some c ->
        c.subscriptions <- List.filter (( <> ) project_id) c.subscriptions
      | None -> ());
      Lwt.return_unit)

(** Broadcast a raw JSON string to all connections subscribed to project_id,
    except the connection identified by [except]. *)
let broadcast ~project_id ?(except = "") msg =
  let%lwt conns =
    Lwt_mutex.with_lock mutex (fun () ->
        let cs =
          Hashtbl.fold
            (fun _ c acc ->
              if c.id <> except && List.mem project_id c.subscriptions then
                c :: acc
              else acc)
            connections []
        in
        Lwt.return cs)
  in
  Lwt_list.iter_p
    (fun c ->
      Lwt.catch
        (fun () -> Dream.send c.ws msg)
        (fun _ -> Lwt.return_unit))
    conns

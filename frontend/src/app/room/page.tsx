"use client";

import { useEffect, useState } from "react";
import { FluxRoom, type RoomUser } from "@/components/room/flux-room";

// One static page for every room (the site is a static export): the Worker serves it for /room/<id>, and next dev's
// rewrite does the same, so the room id is read from the URL path; name, colour, user id and mode from the query.
export default function Room() {
  const [room, setRoom] = useState<{ id: string; mode: "code" | "web"; user: RoomUser } | null>(null);

  useEffect(() => {
    const id = decodeURIComponent(location.pathname.split("/")[2] ?? "");
    if (!id) { location.replace("/"); return; }
    const q = new URLSearchParams(location.search);
    setRoom({
      id,
      mode: q.get("mode") === "web" ? "web" : "code",
      user: { id: q.get("id") || crypto.randomUUID(), name: q.get("name") ?? "", color: q.get("color") ?? "#5FD0A8" },
    });
  }, []);

  return room ? <FluxRoom id={room.id} initialMode={room.mode} user={room.user} /> : null;
}

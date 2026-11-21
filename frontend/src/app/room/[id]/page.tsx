import { FluxRoom } from "@/components/room/flux-room";

export default async function Room({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ name?: string; color?: string; id?: string; mode?: string }> }) {
  const [{ id: roomId }, { name, color, id, mode }] = await Promise.all([params, searchParams]);
  return <FluxRoom id={roomId} initialMode={mode === "web" ? "web" : "code"} user={{ id: id || crypto.randomUUID(), name: name ?? "", color: color ?? "#5FD0A8" }} />;
}

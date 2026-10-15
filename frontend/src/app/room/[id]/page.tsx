import { FluxRoom } from "@/components/room/flux-room";

export default async function Room({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ name?: string; color?: string }> }) {
  const [{ id }, { name, color }] = await Promise.all([params, searchParams]);
  return <FluxRoom id={id} user={{ name: name ?? "", color: color ?? "#5FD0A8" }} />;
}

import { YServer } from "y-partyserver";
import { routePartykitRequest } from "partyserver";

type Env = { Main: DurableObjectNamespace<FluxRoom> };

export class FluxRoom extends YServer<Env> {
  static callbackOptions = {
    debounceWait: 1000,
    debounceMaxWait: 10000,
    timeout: 5000
  };

  async onLoad() {
    const persisted = await this.ctx.storage.get<Uint8Array>("doc");
    if (persisted) {
      const Y = await import("yjs");
      Y.applyUpdate(this.document, persisted);
    }
  }

  async onSave() {
    const Y = await import("yjs");
    await this.ctx.storage.put("doc", Y.encodeStateAsUpdate(this.document));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;

// Environmental gags that every player in a session must see (hydrants, ice cream truck, flamingos).
// A local trigger runs the gag and reports it (online: to the server, which relays it to the others);
// a remote trigger just runs it.
export class PropBus {
  private handlers = new Map<string, () => void>();
  /** Set by the game when online: forwards local triggers to the server. */
  onLocal: (id: string) => void = () => {};

  /** Registers a gag and returns the handler to use as a collider's onShot. */
  register(id: string, fn: () => void): () => void {
    this.handlers.set(id, fn);
    return () => {
      fn();
      this.onLocal(id);
    };
  }

  /** Another player triggered it. */
  remote(id: string) {
    this.handlers.get(id)?.();
  }

  has(id: string) {
    return this.handlers.has(id);
  }
}

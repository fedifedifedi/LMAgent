import { mock } from "bun:test";

// Next.js résout "server-only" en interne ; hors de Next (bun test), on le neutralise.
mock.module("server-only", () => ({}));

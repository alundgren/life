export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Loaded dynamically so the Node-only startup code (and its `process.exit`)
  // never reaches the Edge Runtime bundle Next.js also builds from this file.
  const { registerNode } = await import("@/instrumentation.node");
  await registerNode();
}

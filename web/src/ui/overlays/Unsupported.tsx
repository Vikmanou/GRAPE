interface Props {
  detail?: string | undefined;
}

export function Unsupported({ detail }: Props) {
  return (
    <section className="unsupported" data-testid="unsupported" role="alert">
      <h1>This browser cannot run GRAPE</h1>
      <p>GRAPE draws assembly graphs on the GPU and needs WebGPU or WebGL2.</p>
      {/* WebGL2 support from MDN browser-compat-data (api/WebGL2RenderingContext.json); Edge 79 is the first Chromium Edge. */}
      <p>
        Use a desktop version of Chrome 56, Edge 79, Firefox 51 or Safari 15 or later, with hardware acceleration turned
        on in its settings.
      </p>
      {detail && <p className="unsupported-detail">Details: {detail}</p>}
    </section>
  );
}

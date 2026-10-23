interface Props {
  detail?: string | undefined;
}

export function Unsupported({ detail }: Props) {
  return (
    <section className="unsupported" data-testid="unsupported" role="alert">
      <h1>This browser cannot run GRAPE</h1>
      <p>
        GRAPE draws assembly graphs on the GPU and needs WebGPU. Use a recent desktop version
        of Chrome or Edge.
      </p>
      <p>A WebGL2 mode for other browsers is planned.</p>
      {detail && <p className="unsupported-detail">Details: {detail}</p>}
    </section>
  );
}

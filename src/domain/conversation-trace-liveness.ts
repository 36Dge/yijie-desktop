/** Content projection policy is independent of execution/transport authority.
 * Keep the known historical notice readable without rewriting saved format6. */
export function traceDiagnosticBlocksLive(diagnostic: string | null | undefined): boolean {
  return Boolean(diagnostic && diagnostic !== "command_output_pending_final");
}

import { invoke } from "@tauri-apps/api/core";
import schema from "../../contracts/market-connectors.schema.json";
import { MARKET_CONNECTOR_IPC, type ErrorCode, type Installation, type IpcRequestMap, type IpcResponseMap, type SelectionRef, type MutationResult, type Operation } from "../domain/market-connectors.generated";
import * as validators from "./generated/market-connectors-validator.gen";

type Command = keyof IpcRequestMap;
type Validator = (value: unknown) => boolean;
type JsonSchema = { $ref?: string; type?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema };
const definitions = schema.$defs as unknown as Record<string, JsonSchema>;
export const marketConnectorsEnabled =
  import.meta.env.VITE_YIJIE_ENV === "local" &&
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE === "demo_fast" &&
  import.meta.env.VITE_YIJIE_MARKET_CONNECTORS_ENABLED === "true";

export class ConnectorClientError extends Error {
  constructor(readonly code: ErrorCode, readonly retryable = false) {
    super(code);
    this.name = "ConnectorClientError";
  }
}
function validator(name: string): Validator {
  const candidate = (validators as unknown as Record<string, Validator>)["validate" + name];
  if (!candidate) throw new ConnectorClientError("unsupported_capability");
  return candidate;
}
// Responses intentionally tolerate future fields. Project only source-defined
// fields before a value reaches application state; do not echo or persist extras.
function project(definition: JsonSchema, value: unknown): unknown {
  if (definition.$ref) {
    const name = definition.$ref.replace("#/$defs/", "");
    const target = definitions[name];
    if (!target) throw new ConnectorClientError("unsupported_capability");
    return project(target, value);
  }
  if (definition.type === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(definition.properties ?? {})
      .filter(([key]) => Object.prototype.hasOwnProperty.call(object, key))
      .map(([key, child]) => [key, project(child, object[key])]));
  }
  if (definition.type === "array") {
    return (value as unknown[]).map(item => project(definition.items ?? {}, item));
  }
  return value;
}
export function createMarketConnectorClient(
  transport: (command: string, args: { request: unknown }) => Promise<unknown> = invoke,
) {
  async function call<K extends Command>(
    command: K, contextId: string, payload: IpcRequestMap[K]["payload"],
  ): Promise<IpcResponseMap[K]["data"]> {
    const descriptor = MARKET_CONNECTOR_IPC.find(item => item.command === command);
    if (!descriptor) throw new ConnectorClientError("unsupported_capability");
    const requestId = crypto.randomUUID();
    const request = { schemaVersion: 1, requestId, contextId, payload };
    if (!validator(descriptor.request)(request)) throw new ConnectorClientError("invalid_request");
    const confirmsOperation = descriptor.response === "MutationResponse" || descriptor.response === "OperationResponse";
    const unconfirmed = () => new ConnectorClientError(confirmsOperation ? "outcome_unknown" : "unsupported_capability");
    let response: unknown;
    try {
      response = await transport(command, { request });
    } catch (error) {
      if (validators.validateError(error) && (error.requestId === requestId || (!confirmsOperation && !error.requestId))) {
        throw new ConnectorClientError(error.code, error.retryable);
      }
      // Neither raw native errors nor provider output may leak into the UI.
      throw new ConnectorClientError("temporarily_unavailable", true);
    }
    if (!validator(descriptor.response)(response)) {
      // The command may already have committed. An unreadable receipt must
      // retain its original operation identity for a subsequent status query.
      throw unconfirmed();
    }
    const clean = project(definitions[descriptor.response]!, response) as IpcResponseMap[K];
    if (clean.schemaVersion !== 1 || clean.requestId !== requestId) {
      throw unconfirmed();
    }
    if (confirmsOperation) {
      const target = payload as { operationId: string; installationId?: string; serviceId?: string; desiredEnabled?: boolean };
      const receipt = descriptor.response === "MutationResponse" ? (clean.data as MutationResult).operation : clean.data as Operation;
      if (receipt.operationId !== target.operationId) throw unconfirmed();
      if (descriptor.response === "MutationResponse") {
        const item = (clean.data as MutationResult).installation;
        const action = command === "market_connectors_install_v1" ? "install"
          : command === "market_connectors_uninstall_v1" ? "uninstall"
          : command === "market_connectors_configure_v1" ? "configure"
          : command === "market_connectors_authorize_v1" ? "authorize"
          : target.desiredEnabled ? "enable" : "disable";
        if (receipt.installationId !== item.installationId || receipt.serviceId !== item.serviceId || receipt.action !== action ||
            (target.installationId && target.installationId !== item.installationId) ||
            (target.serviceId && target.serviceId !== item.serviceId)) throw unconfirmed();
      }
    }
    return clean.data;
  }
  const key = (item: Installation, operationId: string) => ({
    installationId: item.installationId, expectedRevision: item.revision, operationId,
  });
  return {
    async snapshot(context: string) {
      const result = await call("market_connectors_snapshot_v1", context, {});
      const services = new Set(result.catalog.map(entry => entry.serviceId));
      const installations = new Set(result.installations.map(item => item.installationId));
      if (result.catalog.length !== 49 || services.size !== 49 || installations.size !== result.installations.length ||
          new Set(result.installations.map(item => item.serviceId)).size !== result.installations.length ||
          result.installations.some(item => !services.has(item.serviceId) || item.status === "removed" ||
            (item.effectiveEnabled && (!item.desiredEnabled || item.connectionStatus !== "ready" || item.configurationStatus !== "configured" ||
              !["authorized", "not_required"].includes(item.authorizationStatus))))) {
        throw new ConnectorClientError("unsupported_capability");
      }
      return result;
    },
    install: (context: string, serviceId: string, operationId: string) =>
      call("market_connectors_install_v1", context, { serviceId, operationId, expectedRevision: 0 }),
    setEnabled: (context: string, item: Installation, enabled: boolean, operationId: string) =>
      call("market_connectors_set_enabled_v1", context, { ...key(item, operationId), desiredEnabled: enabled }),
    uninstall: (context: string, item: Installation, operationId: string) =>
      call("market_connectors_uninstall_v1", context, { ...key(item, operationId), confirmed: true }),
    configure: (context: string, item: Installation, operationId: string) =>
      call("market_connectors_configure_v1", context, { ...key(item, operationId), expectedGeneration: item.generation }),
    authorize: (context: string, item: Installation, operationId: string) =>
      call("market_connectors_authorize_v1", context, { ...key(item, operationId), expectedGeneration: item.generation }),
    operation: (context: string, operationId: string) =>
      call("market_connectors_operation_read_v1", context, { operationId }),
    cancel: (context: string, operationId: string, expectedRevision: number) =>
      call("market_connectors_operation_cancel_v1", context, { operationId, expectedRevision }),
    reopen: (context: string, operationId: string, expectedRevision: number) =>
      call("market_connectors_operation_reopen_v1", context, { operationId, expectedRevision }),
    validateSelection: (context: string, selection: SelectionRef[]) =>
      call("market_connectors_selection_validate_v1", context, { selection }),
  };
}
export const marketConnectorClient = createMarketConnectorClient();
export type MarketConnectorClient = ReturnType<typeof createMarketConnectorClient>;

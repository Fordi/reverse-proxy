import { ReverseProxyConfig } from "./config";
import http from "node:http";
import https from "node:https";

export function createProxy(config: ReverseProxyConfig): Promise<http.Server | https.Server>;

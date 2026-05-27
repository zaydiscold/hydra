import { ProxyAgent } from 'undici';
import { describeProxy, pickAccountProxy, toPlaywrightProxy } from './account-proxy-pool.js';

export const LOCAL_PROXY_BYPASS = 'localhost,127.0.0.1,::1';
export const DIRECT_CHROMIUM_PROXY_ARGS = Object.freeze(['--no-proxy-server']);

function createProxyAgent(accountProxy) {
  if (!accountProxy) return undefined;
  const username = encodeURIComponent(accountProxy.username);
  const password = encodeURIComponent(accountProxy.password);
  return new ProxyAgent(`http://${username}:${password}@${accountProxy.host}:${accountProxy.port}`);
}

function buildAutomationRoute(accountProxy = null) {
  const playwrightProxy = accountProxy
    ? { ...toPlaywrightProxy(accountProxy), bypass: LOCAL_PROXY_BYPASS }
    : undefined;

  return {
    accountProxy,
    mode: accountProxy ? 'account-proxy' : 'direct-localhost',
    label: accountProxy ? describeProxy(accountProxy) : 'direct-localhost',
    chromiumArgs: accountProxy ? [] : [...DIRECT_CHROMIUM_PROXY_ARGS],
    dispatcher: createProxyAgent(accountProxy),
    playwrightProxy,
  };
}

export function normalizeAutomationNetworkRoute(routeOrProxy = null) {
  if (routeOrProxy?.mode && Object.prototype.hasOwnProperty.call(routeOrProxy, 'accountProxy')) {
    return routeOrProxy;
  }
  if (routeOrProxy?.host && routeOrProxy?.port) {
    return buildAutomationRoute(routeOrProxy);
  }
  return buildAutomationRoute(null);
}

export function pickAutomationNetworkRoute({ allowAccountProxy = true } = {}) {
  return buildAutomationRoute(allowAccountProxy ? pickAccountProxy() : null);
}

export function describeAutomationNetworkRoute(routeOrProxy = null) {
  return normalizeAutomationNetworkRoute(routeOrProxy).label;
}

export function playwrightProxyForAutomation(routeOrProxy = null) {
  return normalizeAutomationNetworkRoute(routeOrProxy).playwrightProxy;
}

export function mergeAutomationLaunchArgs(args = [], routeOrProxy = null) {
  const route = normalizeAutomationNetworkRoute(routeOrProxy);
  const callerArgs = Array.isArray(args) ? args : [];
  return [...new Set([...route.chromiumArgs, ...callerArgs])];
}

function proxyAgentForAutomation(routeOrProxy = null) {
  const route = normalizeAutomationNetworkRoute(routeOrProxy);
  const { accountProxy } = route;
  if (!accountProxy) return undefined;
  return route.dispatcher || createProxyAgent(accountProxy);
}

export function fetchOptionsWithAutomationProxy(options = {}, routeOrProxy = null) {
  const dispatcher = proxyAgentForAutomation(routeOrProxy);
  return dispatcher ? { ...options, dispatcher } : options;
}

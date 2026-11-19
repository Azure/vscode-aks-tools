import * as assert from "assert";
import { CoreV1Api, RequestContext, V1NamespaceList } from "@kubernetes/client-node";
import { listAllNamespaces } from "../../../commands/utils/clusters";

describe("Container Assist namespace listing", () => {
    it("follows Kubernetes list continuation tokens", async () => {
        const requests: object[] = [];
        const pages: V1NamespaceList[] = [
            {
                items: [{ metadata: { name: "default" } }],
                metadata: { _continue: "next-page" },
            },
            {
                items: [{ metadata: { name: "application" } }],
                metadata: {},
            },
        ];
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: async (request) => {
                requests.push(request ?? {});
                const page = pages.shift();
                if (!page) throw new Error("unexpected page request");
                return page;
            },
        };

        const result = await listAllNamespaces(client);

        assert.strictEqual(result.succeeded, true);
        if (result.succeeded) {
            assert.deepStrictEqual(
                result.result.map((namespace) => namespace.metadata?.name),
                ["default", "application"],
            );
        }
        assert.deepStrictEqual(requests, [
            { _continue: undefined, limit: 500, timeoutSeconds: 30 },
            { _continue: "next-page", limit: 500, timeoutSeconds: 30 },
        ]);
    });

    it("returns Kubernetes API errors without throwing", async () => {
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: async () => {
                throw new Error('cannot list resource "namespaces"');
            },
        };

        const result = await listAllNamespaces(client);

        assert.deepStrictEqual(result, { succeeded: false, error: 'cannot list resource "namespaces"' });
    });

    it("preserves structured Kubernetes authorization failures", async () => {
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: async () => {
                throw {
                    code: 403,
                    body: { message: 'User cannot list resource "namespaces" at the cluster scope' },
                };
            },
        };

        const result = await listAllNamespaces(client);

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: 'Kubernetes API returned 403: User cannot list resource "namespaces" at the cluster scope',
        });
    });

    it("rejects repeated continuation tokens", async () => {
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: async () => ({ items: [], metadata: { _continue: "repeat" } }),
        };

        const result = await listAllNamespaces(client);

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: "Kubernetes API repeated a namespace continuation token.",
        });
    });

    it("rejects a server page that ignores the namespace limit", async () => {
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: async () => ({
                items: Array.from({ length: 10_001 }, () => ({ metadata: { name: "namespace" } })),
                metadata: {},
            }),
        };

        const result = await listAllNamespaces(client);

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: "Kubernetes API returned more than 10000 namespaces.",
        });
    });

    it("aborts a request when the total deadline expires", async () => {
        const client: Pick<CoreV1Api, "listNamespace"> = {
            listNamespace: (_request, options) => {
                return new Promise<V1NamespaceList>((_resolve, reject) => {
                    const middleware = options?.middleware?.[0];
                    assert.ok(middleware);
                    const context = {
                        setSignal: (signal: AbortSignal) => {
                            signal.addEventListener("abort", () => reject(new Error("request aborted")));
                        },
                    } as RequestContext;
                    void middleware.pre(context).toPromise();
                });
            },
        };

        const result = await listAllNamespaces(client, 1);

        assert.deepStrictEqual(result, { succeeded: false, error: "request aborted" });
    });
});

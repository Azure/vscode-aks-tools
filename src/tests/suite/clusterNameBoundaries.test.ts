import * as assert from "assert";
import * as sinon from "sinon";
import * as k8s from "vscode-kubernetes-tools-api";
import * as kubectlModule from "../../commands/utils/kubectl";
import { KubectlClusterOperations, validateGadgetFilters } from "../../commands/aksInspektorGadget/clusterOperations";
import { getLinuxNodes } from "../../panels/utilities/KubectlNetworkHelper";
import { NamespaceSelection } from "../../webview-contract/webviewDefinitions/inspektorGadget";
import { getAzureServiceResourceTypes } from "../../tree/azureResourceNodeContributor";
import * as vscode from "vscode";
import { createCurlPodArgs, getClusterIP, parsePort } from "../../panels/utilities/KaitoHelpers";

/**
 * Guards the boundaries where names served by a cluster's API server enter the
 * extension. kubectl does no client-side validation on read, so a hostile endpoint can
 * return any bytes it likes for `metadata.name`; several features interpolate those
 * names into kubectl command strings that the kubernetes-tools dependency runs through
 * a shell.
 *
 * These assert at the call sites rather than on the validator alone, so that removing a
 * boundary check fails the build even if the validator itself still passes its tests.
 */
describe("Cluster-supplied name boundaries", () => {
    // A plausible node name followed by a POSIX command substitution, as in the reported
    // proof of concept. A conforming API server cannot assign this.
    const hostileNode = "aks-np1-12345678-vmss000000$(touch /tmp/aks-pwned)";
    const hostileNamespace = "default& calc.exe & rem ";

    const fakeKubectl = { api: {} } as k8s.APIAvailable<k8s.KubectlV1>;
    const clusterInfo = { name: "test-cluster", kubeconfigYaml: "" };

    let invokeStub: sinon.SinonStub;

    function stubKubectlStdout(stdout: string) {
        invokeStub = sinon
            .stub(kubectlModule, "invokeKubectlCommandArgs")
            .resolves({ succeeded: true, result: { code: 0, stdout, stderr: "" } });
    }

    function resourceList(names: string[]) {
        return JSON.stringify({ items: names.map((name) => ({ metadata: { name } })) });
    }

    afterEach(() => {
        sinon.restore();
    });

    function operations() {
        return new KubectlClusterOperations(fakeKubectl, clusterInfo, "/tmp/kubeconfig");
    }

    describe("Inspektor Gadget", () => {
        it("refuses a hostile node name served by the API server", async () => {
            stubKubectlStdout(resourceList(["aks-node-1", hostileNode, "aks-node-3"]));

            const result = await operations().getNodes();

            assert.ok(!result.succeeded, "a hostile node name must not reach the caller");
            assert.ok(result.error.includes("node"), `error should name the resource: ${result.error}`);
        });

        it("does not trim a hostile leading newline from cluster output", async () => {
            stubKubectlStdout(resourceList(["\nwhoami"]));

            const result = await operations().getNodes();

            assert.ok(!result.succeeded);
        });

        it("refuses a hostile namespace served by the API server", async () => {
            stubKubectlStdout(resourceList(["default", hostileNamespace]));

            const result = await operations().getNamespaces();

            assert.ok(!result.succeeded, "a hostile namespace must not reach the caller");
        });

        it("accepts ordinary names unchanged", async () => {
            stubKubectlStdout(resourceList(["aks-node-1", "aks-node-2"]));

            const result = await operations().getNodes();

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, ["aks-node-1", "aks-node-2"]);
        });

        it("returns an empty list when the cluster has no nodes", async () => {
            stubKubectlStdout(resourceList([]));

            const result = await operations().getNodes();

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, []);
        });

        it("refuses a hostile namespace argument before running kubectl", async () => {
            stubKubectlStdout(resourceList(["some-pod"]));

            const result = await operations().getPods(hostileNamespace);

            assert.ok(!result.succeeded, "should reject before composing a command");
            assert.ok(invokeStub.notCalled, "kubectl must not be invoked with a hostile namespace");
        });

        it("refuses a hostile pod name argument before running kubectl", async () => {
            stubKubectlStdout(JSON.stringify({ spec: { containers: [{ name: "nginx" }] } }));

            const result = await operations().getContainers("default", hostileNode);

            assert.ok(!result.succeeded, "should reject before composing a command");
            assert.ok(invokeStub.notCalled, "kubectl must not be invoked with a hostile pod name");
        });

        it("refuses hostile container names served by the API server", async () => {
            stubKubectlStdout(
                JSON.stringify({
                    spec: { containers: [{ name: "nginx" }, { name: "sidecar$(touch /tmp/aks-pwned)" }] },
                }),
            );

            const result = await operations().getContainers("default", "my-pod");

            assert.ok(!result.succeeded, "a hostile container name must not reach the caller");
        });
    });

    describe("validateGadgetFilters", () => {
        const baseArguments = {
            gadgetCategory: "trace",
            gadgetResource: "dns",
            filters: { namespace: NamespaceSelection.Default },
        };

        it("rejects a hostile node filter arriving over the webview channel", () => {
            const result = validateGadgetFilters({
                ...baseArguments,
                filters: { ...baseArguments.filters, nodeName: hostileNode },
            });

            assert.ok(!result.succeeded);
        });

        it("rejects a hostile namespace filter", () => {
            const result = validateGadgetFilters({
                ...baseArguments,
                filters: { namespace: hostileNamespace },
            });

            assert.ok(!result.succeeded);
        });

        it("rejects a hostile pod and container filter", () => {
            assert.ok(
                !validateGadgetFilters({
                    ...baseArguments,
                    filters: { ...baseArguments.filters, podName: hostileNode },
                }).succeeded,
            );
            assert.ok(
                !validateGadgetFilters({
                    ...baseArguments,
                    filters: { ...baseArguments.filters, containerName: hostileNamespace },
                }).succeeded,
            );
        });

        it("allows the namespace selection sentinels, which are not names", () => {
            assert.ok(
                validateGadgetFilters({ ...baseArguments, filters: { namespace: NamespaceSelection.All } }).succeeded,
            );
            assert.ok(
                validateGadgetFilters({ ...baseArguments, filters: { namespace: NamespaceSelection.Default } })
                    .succeeded,
            );
        });

        it("allows an ordinary trace request", () => {
            const result = validateGadgetFilters({
                ...baseArguments,
                filters: {
                    namespace: "kube-system",
                    nodeName: "aks-np1-12345678-vmss000000",
                    podName: "coredns-abc123",
                    containerName: "coredns",
                },
            });

            assert.ok(result.succeeded);
        });

        it("rejects every dynamic field that could alter the command", () => {
            const hostileArguments = [
                { ...baseArguments, gadgetCategory: "trace; whoami" },
                { ...baseArguments, gadgetResource: "dns$(whoami)" },
                { ...baseArguments, filters: { ...baseArguments.filters, labels: { app: "x; whoami" } } },
                { ...baseArguments, sortString: "pid; whoami" },
                { ...baseArguments, maxRows: "1; whoami" as unknown as number },
            ];

            for (const args of hostileArguments) {
                assert.ok(!validateGadgetFilters(args).succeeded);
            }
        });

        it("rejects names with leading whitespace rather than executing the original value", () => {
            const result = validateGadgetFilters({
                ...baseArguments,
                filters: { ...baseArguments.filters, nodeName: "\nnode-1" },
            });
            assert.ok(!result.succeeded);
        });

        it("does not invoke the blocking command for a hostile non-name field", async () => {
            stubKubectlStdout("");

            const result = await operations().runTrace({
                ...baseArguments,
                gadgetResource: "dns; whoami",
            });

            assert.ok(!result.succeeded);
            assert.ok(invokeStub.notCalled);
        });
    });

    describe("Retina node listing", () => {
        it("refuses a hostile node name", async () => {
            stubKubectlStdout(resourceList(["aks-node-1", hostileNode]));

            const result = await getLinuxNodes(fakeKubectl, "/tmp/kubeconfig");

            assert.ok(!result.succeeded, "a hostile node name must not reach the Retina capture flow");
        });

        it("accepts ordinary node names", async () => {
            stubKubectlStdout(resourceList(["aks-node-1", "aks-node-2"]));

            const result = await getLinuxNodes(fakeKubectl, "/tmp/kubeconfig");

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, ["aks-node-1", "aks-node-2"]);
        });
    });
});

describe("Azure Services tree", () => {
    // Fields are space-separated, newline first: name, kind, singular, plural, group, shortName.
    function kubectlReturning(...lines: string[]) {
        const stdout = lines.map((l) => `\n${l}`).join("");
        return { invokeCommand: async () => ({ code: 0, stdout, stderr: "" }) } as unknown as k8s.KubectlV1;
    }

    it("accepts Azure CRDs with valid names", async () => {
        const result = await getAzureServiceResourceTypes(
            kubectlReturning("vaults.keyvault.azure.com Vault vault vaults keyvault.azure.com kv"),
        );

        assert.ok(result.succeeded);
        assert.deepStrictEqual(
            result.result.map((r) => r.abbreviation),
            ["kv"],
        );
    });

    it("refuses a hostile short name, which vscode-kubernetes-tools runs in a shell", async () => {
        const result = await getAzureServiceResourceTypes(
            kubectlReturning(
                "vaults.keyvault.azure.com Vault vault vaults keyvault.azure.com kv$(touch${IFS}/tmp/pwned)",
            ),
        );

        assert.ok(!result.succeeded);
    });
});

describe("parsePort", () => {
    it("accepts a port number", () => {
        assert.strictEqual(parsePort("8080"), 8080);
        assert.strictEqual(parsePort("80\n"), 80);
    });

    it("rejects anything else, so it cannot alter the port-forward terminal command", () => {
        for (const value of ["", "0", "65536", "80; touch /tmp/pwned #", "8o", "-1", "1e3", " "]) {
            assert.strictEqual(parsePort(value), undefined, JSON.stringify(value));
        }
    });
});

describe("KAITO test query", () => {
    const fakeKubectl = { api: {} } as k8s.APIAvailable<k8s.KubectlV1>;

    afterEach(() => sinon.restore());

    function curlArgs(clusterIP: string, prompt: string, runtime: string) {
        const args = createCurlPodArgs(
            "curl-1",
            "workspace-phi-3-5-mini",
            clusterIP,
            prompt,
            0.7,
            0.9,
            50,
            1.1,
            100,
            runtime,
        );
        const curl = args.slice(args.indexOf("--") + 1);
        return { args, url: curl[3], body: JSON.parse(curl[curl.indexOf("-d") + 1]) };
    }

    it("sends the prompt as JSON in a single argument, unchanged", () => {
        const prompt = `it's a "test" with \`ticks\`\nand $(x)`;
        const { body } = curlArgs("10.0.0.5", prompt, "vllm");
        assert.strictEqual(body.prompt, prompt);
        assert.strictEqual(body.model, "phi-3.5-mini");
    });

    it("chooses the endpoint by runtime and brackets IPv6 addresses", () => {
        assert.strictEqual(curlArgs("10.0.0.5", "hi", "vllm").url, "http://10.0.0.5/v1/completions");
        assert.strictEqual(curlArgs("fd00::1", "hi", "transformers").url, "http://[fd00::1]/chat");
    });

    it("accepts only an IP address as the cluster IP", async () => {
        sinon.stub(vscode.window, "showErrorMessage");
        const stdout = sinon.stub(kubectlModule, "invokeKubectlCommandArgs");
        const clusterIP = (value: string) => {
            stdout.resolves({ succeeded: true, result: { code: 0, stdout: value, stderr: "" } });
            return getClusterIP("/tmp/kubeconfig", "workspace-phi", fakeKubectl, "default");
        };

        assert.strictEqual(await clusterIP("10.0.0.5"), "10.0.0.5");
        assert.strictEqual(await clusterIP("fd00::1"), "fd00::1");
        assert.strictEqual(await clusterIP("None"), "");
        assert.strictEqual(await clusterIP("1.2.3.4; touch /tmp/pwned"), "");
    });
});

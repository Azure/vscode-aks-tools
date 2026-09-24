import * as assert from "assert";
import * as sinon from "sinon";
import * as k8s from "vscode-kubernetes-tools-api";
import * as kubectlModule from "../../commands/utils/kubectl";
import { KubectlClusterOperations, validateGadgetFilters } from "../../commands/aksInspektorGadget/clusterOperations";
import { getLinuxNodes } from "../../panels/utilities/KubectlNetworkHelper";
import { NamespaceSelection } from "../../webview-contract/webviewDefinitions/inspektorGadget";

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

    afterEach(() => {
        sinon.restore();
    });

    function operations() {
        return new KubectlClusterOperations(fakeKubectl, clusterInfo, "/tmp/kubeconfig");
    }

    describe("Inspektor Gadget", () => {
        it("refuses a hostile node name served by the API server", async () => {
            stubKubectlStdout(`aks-node-1\n${hostileNode}\naks-node-3`);

            const result = await operations().getNodes();

            assert.ok(!result.succeeded, "a hostile node name must not reach the caller");
            assert.ok(result.error.includes("node"), `error should name the resource: ${result.error}`);
        });

        it("refuses a hostile namespace served by the API server", async () => {
            stubKubectlStdout(`default\n${hostileNamespace}`);

            const result = await operations().getNamespaces();

            assert.ok(!result.succeeded, "a hostile namespace must not reach the caller");
        });

        it("accepts ordinary names unchanged", async () => {
            stubKubectlStdout("aks-node-1\naks-node-2\n");

            const result = await operations().getNodes();

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, ["aks-node-1", "aks-node-2"]);
        });

        it("returns an empty list when the cluster has no nodes", async () => {
            stubKubectlStdout("");

            const result = await operations().getNodes();

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, []);
        });

        it("refuses a hostile namespace argument before running kubectl", async () => {
            stubKubectlStdout("some-pod");

            const result = await operations().getPods(hostileNamespace);

            assert.ok(!result.succeeded, "should reject before composing a command");
            assert.ok(invokeStub.notCalled, "kubectl must not be invoked with a hostile namespace");
        });

        it("refuses a hostile pod name argument before running kubectl", async () => {
            stubKubectlStdout("nginx");

            const result = await operations().getContainers("default", hostileNode);

            assert.ok(!result.succeeded, "should reject before composing a command");
            assert.ok(invokeStub.notCalled, "kubectl must not be invoked with a hostile pod name");
        });

        it("refuses hostile container names served by the API server", async () => {
            stubKubectlStdout(`nginx sidecar$(touch /tmp/aks-pwned)`);

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
    });

    describe("Retina node listing", () => {
        it("refuses a hostile node name", async () => {
            stubKubectlStdout(`aks-node-1\n${hostileNode}`);

            const result = await getLinuxNodes(fakeKubectl, "/tmp/kubeconfig");

            assert.ok(!result.succeeded, "a hostile node name must not reach the Retina capture flow");
        });

        it("accepts ordinary node names", async () => {
            stubKubectlStdout("aks-node-1\naks-node-2");

            const result = await getLinuxNodes(fakeKubectl, "/tmp/kubeconfig");

            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, ["aks-node-1", "aks-node-2"]);
        });
    });
});

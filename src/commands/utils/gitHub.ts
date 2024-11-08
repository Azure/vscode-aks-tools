import { Octokit } from "@octokit/rest";
import { Errorable, failed, getErrorMessage } from "./errorable";
import sodium from "libsodium-wrappers";

export async function getRepoPublicKey(
    octokit: Octokit,
    ghRepoOwnerName: string,
    ghRepoName: string,
): Promise<Errorable<GitHubKey>> {
    try {
        const repoPublicKey = await octokit.actions.getRepoPublicKey({
            owner: ghRepoOwnerName,
            repo: ghRepoName,
        });

        return { succeeded: true, result: repoPublicKey.data };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function createGitHubSecret(
    octokit: Octokit,
    ghRepoOwnerName: string,
    ghRepoName: string,
    publicKey: GitHubKey,
    secretName: string,
    secretValue: string,
): Promise<Errorable<string>> {
    const encryptedSecretValue = await encryptSecretValue(publicKey, secretValue);
    if (failed(encryptedSecretValue)) {
        return encryptedSecretValue;
    }

    try {
        const secret = await octokit.actions.createOrUpdateRepoSecret({
            owner: ghRepoOwnerName,
            repo: ghRepoName,
            secret_name: secretName,
            encrypted_value: encryptedSecretValue.result,
            key_id: publicKey.key_id,
        });

        return { succeeded: true, result: secret.url };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function deleteGitHubSecret(
    octokit: Octokit,
    ghRepoOwnerName: string,
    ghRepoName: string,
    secretName: string,
): Promise<Errorable<void>> {
    try {
        await octokit.actions.deleteRepoSecret({
            owner: ghRepoOwnerName,
            repo: ghRepoName,
            secret_name: secretName,
        });

        return { succeeded: true, result: undefined };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

async function encryptSecretValue(publicKey: GitHubKey, secretValue: string): Promise<Errorable<string>> {
    // See:
    // https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api?apiVersion=2022-11-28#example-encrypting-a-secret-using-nodejs
    await sodium.ready;
    try {
        const publicKeyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
        const secretValueBytes = sodium.from_string(secretValue);

        const encryptedBytes = sodium.crypto_box_seal(secretValueBytes, publicKeyBytes);
        const result = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

        return { succeeded: true, result };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export type GitHubKey = {
    key: string; // Base64-encoded
    key_id: string;
};

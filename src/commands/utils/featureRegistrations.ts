import { FeatureClient } from "@azure/arm-features";
import { longRunning } from "./host";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000; // 5 seconds

export type MultipleFeatureRegistration = {
    resourceProviderNamespace: string;
    featureName: string;
};

export type FeatureRegistrationResult = {
    resourceProviderNamespace: string;
    featureName: string;
    registrationStatus: string;
};

export async function createFeatureRegistrationsWithRetry(
    featureClient: FeatureClient,
    resourceProviderNamespace: string,
    featureName: string,
): Promise<FeatureRegistrationResult> {
    let retries = 0;
    let registrationStatus = "Registering";
    //register the feature
    await longRunning(`Registering the preview features.`, () => {
        return featureClient.features.register(resourceProviderNamespace, featureName);
    });
    do {
        // get the registration status
        const featureRegistrationResult = await longRunning(`Getting the preview feature registration status.`, () => {
            return featureClient.features.get(resourceProviderNamespace, featureName);
        });
        const result = featureRegistrationResult.properties?.state || "Failed";
        if (result === "Registered") {
            registrationStatus = "Registered";
            break;
        } else if (result === "Registering" && retries < MAX_RETRIES) {
            // if the feature is still registering and we haven't reached the max retries, wait and try again
            registrationStatus = "Registering";
            retries++;
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
            // if the feature registration failed or we reached the max retries but still feature registration status is registering, throw an error
            throw new Error(
                `Failed to register the preview feature ${featureName} for ${resourceProviderNamespace}. Current state: ${result}`,
            );
        }
    } while (registrationStatus === "Registering" && retries < MAX_RETRIES);

    return {
        resourceProviderNamespace,
        featureName,
        registrationStatus,
    };
}

export async function createMultipleFeatureRegistrations(
    featureClient: FeatureClient,
    featureRegistrations: MultipleFeatureRegistration[],
): Promise<FeatureRegistrationResult[]> {
    const featureRegistrationResults = featureRegistrations.map(async (featureRegistration) => {
        return createFeatureRegistrationsWithRetry(
            featureClient,
            featureRegistration.resourceProviderNamespace,
            featureRegistration.featureName,
        );
    });
    return await Promise.all(featureRegistrationResults);
}

import { FeatureClient } from "@azure/arm-features";
import { longRunning } from "./host";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 60000; // 1 minute

export enum FeatureRegistrationState {
    Registered = "Registered",
    Registering = "Registering",
    Failed = "Failed",
}

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
): Promise<void> {
    let retries = 0;
    //register the feature
    try {
        await featureClient.features.register(resourceProviderNamespace, featureName);
    } catch (error) {
        throw new Error(
            `Failed to initiate registration for feature ${featureName} in ${resourceProviderNamespace}: ${error}`,
        );
    }
    while (retries < MAX_RETRIES) {
        // get the registration status
        const featureRegistrationResult = await featureClient.features.get(resourceProviderNamespace, featureName);
        const result = featureRegistrationResult?.properties?.state ?? FeatureRegistrationState.Failed;
        switch (result) {
            case FeatureRegistrationState.Registered:
                console.log(`Feature ${featureName} registered successfully for ${resourceProviderNamespace}.`);
                return;

            case FeatureRegistrationState.Registering:
                retries++;
                console.log(`Feature ${featureName} is still registering. Retry ${retries}/${MAX_RETRIES}.`);
                await delay(RETRY_DELAY_MS);
                break;

            default:
                throw new Error(
                    `Failed to register the preview feature ${featureName} for ${resourceProviderNamespace}. Current state: ${result}, please try again.`,
                );
        }
    }
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createMultipleFeatureRegistrations(
    featureClient: FeatureClient,
    featureRegistrations: MultipleFeatureRegistration[],
): Promise<void> {
    await longRunning(`Registering the preview features.`, async () => {
        try {
            const featureRegistrationResults = featureRegistrations.map(async (featureRegistration) => {
                return createFeatureRegistrationsWithRetry(
                    featureClient,
                    featureRegistration.resourceProviderNamespace,
                    featureRegistration.featureName,
                );
            });
            await Promise.all(featureRegistrationResults);
            console.log("All features registered successfully.");
        } catch (error) {
            console.error("Error registering features:", error);
            throw error;
        }
    });
}

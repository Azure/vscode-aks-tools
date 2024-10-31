// helper for parsing the conditions object on a workspace
function statusToBoolean(status: string): boolean {
    if (status.toLowerCase() === "true") {
        return true;
    }
    return false;
}

// This helper function parses & returns resource values for the conditions object on a workspace
export function getConditions(conditions: Array<{ type: string; status: string }>) {
    let resourceReady = null;
    let inferenceReady = null;
    let workspaceReady = null;
    conditions.forEach(({ type, status }) => {
        switch (type.toLowerCase()) {
            case "resourceready":
                resourceReady = statusToBoolean(status);
                break;
            case "workspacesucceeded":
                workspaceReady = statusToBoolean(status);
                break;
            case "inferenceready":
                inferenceReady = statusToBoolean(status);
                break;
        }
    });
    return { resourceReady, inferenceReady, workspaceReady };
}

export function convertAgeToMinutes(creationTimestamp: string): number {
    const createdTime = new Date(creationTimestamp);
    const currentTime = new Date();
    const differenceInMilliseconds = currentTime.getTime() - createdTime.getTime();
    const differenceInMinutes = Math.floor(differenceInMilliseconds / 1000 / 60);
    return differenceInMinutes;
}

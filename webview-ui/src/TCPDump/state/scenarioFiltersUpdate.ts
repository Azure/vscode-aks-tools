import {
    CaptureScenario,
    CaptureScenarioFilters,
    ScenarioFilterValue,
    SpecificPodFilter,
    TwoPodsFilter,
} from "../state";

export function updateScenarioFilter(
    allFilters: CaptureScenarioFilters,
    value: ScenarioFilterValue,
): CaptureScenarioFilters {
    return {
        ...allFilters,
        [value.scenario]: value.filters,
    };
}

export function getPcapFilterStringParts(scenario: CaptureScenario, filters: CaptureScenarioFilters): string[] {
    switch (scenario) {
        case "SpecificPod":
            return getSpecificPodPcapFilters(filters[scenario]);
        case "TwoPods":
            return getTwoPodsPcapFilters(filters[scenario]);
    }
}

function getSpecificPodPcapFilters(filter: SpecificPodFilter): string[] {
    if (!filter.pod) return [];
    switch (filter.packetDirection) {
        case "SentAndReceived":
            return [`host ${filter.pod.ipAddress}`];
        case "Sent":
            return [`src ${filter.pod.ipAddress}`];
        case "Received":
            return [`dst ${filter.pod.ipAddress}`];
    }
}

function getTwoPodsPcapFilters(filter: TwoPodsFilter): string[] {
    if (!filter.sourcePod && !filter.destPod) return [];
    const filters = [];
    if (filter.sourcePod) {
        switch (filter.packetDirection) {
            case "SourceToDestination":
                filters.push(`src ${filter.sourcePod.ipAddress}`);
                break;
            case "Bidirectional":
                filters.push(`host ${filter.sourcePod.ipAddress}`);
                break;
        }
    }

    if (filter.destPod) {
        switch (filter.packetDirection) {
            case "SourceToDestination":
                filters.push(`dst ${filter.destPod.ipAddress}`);
                break;
            case "Bidirectional":
                filters.push(`host ${filter.destPod.ipAddress}`);
                break;
        }
    }

    return filters;
}

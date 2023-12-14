export const transportLayerProtocols = ["TCP", "UDP", "ICMP"];
export type TransportLayerProtocol = (typeof transportLayerProtocols)[number];

export const applicationLayerProtocols = ["HTTP", "HTTPS", "DNS"] as const;
export type ApplicationLayerProtocol = (typeof applicationLayerProtocols)[number];

export type ProtocolMapping = Record<
    ApplicationLayerProtocol,
    {
        port: number;
        protocol: TransportLayerProtocol | null;
    }
>;

export const protocolMapping: ProtocolMapping = {
    HTTP: { port: 80, protocol: "TCP" },
    HTTPS: { port: 443, protocol: "TCP" },
    DNS: { port: 53, protocol: null }, // TODO: Do we do like NSGs and use "DNS (TCP)" and "DNS (UDP)"?
};

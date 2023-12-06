export type TransportLayerProtocol = "TCP" | "UDP" | "ICMP";

export type ApplicationLayerProtocol = "HTTP" | "HTTPS" | "DNS";

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

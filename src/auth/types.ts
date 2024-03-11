export type SignInStatus = "Initializing" | "SigningIn" | "SignedIn" | "SignedOut";

export type TokenInfo = {
    token: string;
    expiry: Date;
};

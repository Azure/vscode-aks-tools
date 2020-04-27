export interface AppLensARMresponse {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly resourceGroup: string;
    readonly properties: any;
    readonly type: string;
  }

  export interface AppLensAPIResult {
    readonly apiresult: AppLensARMresponse;
  }

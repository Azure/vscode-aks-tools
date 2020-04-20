export class AppLensARMresponse {
    id: String;
    name: String;
    location: String;
    resourceGroup: String;
    properties: any;
    type: string;

    constructor(armresponse: any) {
        this.id = armresponse.id;
        this.name = armresponse.name;
        this.location = armresponse.location;
        this.resourceGroup = armresponse.resourceGroup;
        this.properties = armresponse.properties;
        this.type = armresponse.type;
    }
  }

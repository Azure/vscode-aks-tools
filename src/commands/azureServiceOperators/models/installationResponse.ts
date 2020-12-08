import * as k8s from 'vscode-kubernetes-tools-api';

 export interface InstallationResponse {
    clusterName: string;
    installCertManagerResult?: k8s.KubectlV1.ShellResult;
    checkCertManagerRolloutStatusResult?: k8s.KubectlV1.ShellResult;
    installOlmCrdResult?: k8s.KubectlV1.ShellResult;
    installOlmResult?: k8s.KubectlV1.ShellResult;
    installOperatorResult?: k8s.KubectlV1.ShellResult;
    installIssuerCertResult?: k8s.KubectlV1.ShellResult;
    installOperatorSettingsResult?: k8s.KubectlV1.ShellResult;
    getOperatorsPodResult?: k8s.KubectlV1.ShellResult;
}
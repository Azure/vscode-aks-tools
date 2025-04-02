# Run Retina Distributed Capture from AKS Cluster Linux Nodes

## Run Retina Capture

Right click on your AKS cluster and select **Troubleshoot Network Health** and then click on **Run Retina Capture** to capture logs like iptables-rules, [ip-resrouces.txt and other key distributed captures form this azure networking tool](https://retina.sh/docs/captures/cli#file-and-directory-structure-inside-the-tarball) for any Linux nodes in yout AKS cluster.

There are two options to run the capture:

### Download the capture locally

![Step 1: Menu](../resources/right-click-download-retina-capture.png)

![Step 2: Select Nodes to Run Retina](../resources/retina-select-nodes.png)

![Step 3: Retina Ran Successfully](../resources/retina-success-run-download.png)

### Upload the capture to Azure Storage

Before uploading the capture to Azure Storage, ensure the following prerequisites are met:

1. A storage account exists in the same region as your AKS cluster.

2. The storage account is configured in the Diagnostic settings of your AKS cluster.

3. A container is created within the storage account to store the capture.

![Step 1: Menu](../resources/right-click-upload-retina-capture.png)
![Step 2: Select Storage Account](../resources/retina-select-storage-account.png)
![Step 3: Select Container](../resources/retina-select-container.png)
![Step 4: Select Nodes to Run Retina](../resources/retina-select-nodes.png)
![Step 5: Retina Ran Successfully](../resources/retina-success-run-upload.png)
![Step 6: Check Storage Account](../resources/retina-success-check-storage-account.png)

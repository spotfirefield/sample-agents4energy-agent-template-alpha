import { S3Client, ListObjectsV2Command, CopyObjectCommand } from "@aws-sdk/client-s3";

import outputs from '../amplify_outputs.json'

const SMALL_CUTOFF = 40
const BATCH_SIZE = 100

async function main() {
    const s3Client = new S3Client();
    const prefix = "global/well-files/";

    let continuationToken: string | undefined;
    let numPdfYamlFiles = 0
    let smallPdfYamlFiles = []

    do {
        const listObjectsResponse = await s3Client.send(new ListObjectsV2Command({
            Bucket: outputs.storage.bucket_name,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken
        }));
        continuationToken = listObjectsResponse.NextContinuationToken;

        const pdfYamlFiles = (listObjectsResponse.Contents || []).filter(
            item => item.Key && item.Key.toLowerCase().endsWith('.pdf.yaml')
        )

        const newSmallPdfYamlFiles = pdfYamlFiles.filter(
            item => (item.Size && item.Size < SMALL_CUTOFF)
        )

        numPdfYamlFiles += pdfYamlFiles.length

        smallPdfYamlFiles.push(...newSmallPdfYamlFiles)

        console.log(`... Found ${numPdfYamlFiles} .pdf.yaml files so far`)

    } while (continuationToken);

    console.log(smallPdfYamlFiles)
    console.log(`Found ${numPdfYamlFiles} total .pdf.yaml files, ${smallPdfYamlFiles.length} of which had size less than ${SMALL_CUTOFF}`)


    // If the YAML file has a small size, it did not correctly process the pdf file.
    for (let i = 0; i < smallPdfYamlFiles.length; i += BATCH_SIZE) {
            console.log(`Redriving batch ${i / BATCH_SIZE} of ${smallPdfYamlFiles.length / BATCH_SIZE}`)
            await Promise.all(
                smallPdfYamlFiles.slice(i, i + BATCH_SIZE).filter(file => file && file.Key).map(file =>
                    s3Client.send(new CopyObjectCommand({
                        Bucket: outputs.storage.bucket_name,
                        Key: file.Key!.slice(0,file.Key!.length - 5),
                        CopySource: `/${outputs.storage.bucket_name}/${file.Key!.slice(0,file.Key!.length - 5)}`,
                        ContentType: 'application/pdf',
                        MetadataDirective: 'REPLACE'
                    }))
                )
            )
        }
}

main().catch(console.error);
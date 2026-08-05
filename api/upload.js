import { handleUpload } from '@vercel/blob/client';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo par fichier

export default async function handler(request, response) {
  try {
    const jsonResponse = await handleUpload({
      body: request.body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('submissions/')) {
          throw new Error('Chemin de dépôt invalide.');
        }
        return {
          allowedContentTypes: ALLOWED_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_SIZE,
        };
      },
      onUploadCompleted: async () => {
        // Rien à faire ici : le récapitulatif est écrit par /api/finalize
        // une fois que la famille valide l'étape 5.
      },
    });

    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message || 'Échec du téléversement.' });
  }
}

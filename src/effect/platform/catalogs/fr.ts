import type { MessageKey } from './en';

export const frCatalog: Record<MessageKey, string> = {
  'areas.circularReference':
    'Impossible de definir cette zone parente car cela creerait une reference circulaire.',
  'areas.deleted': 'Zone supprimee avec succes.',
  'areas.locationNotFound': 'Emplacement introuvable.',
  'areas.notFound': 'Zone introuvable.',
  'areas.parentLocationMismatch':
    'La zone parente doit appartenir au meme emplacement.',
  'areas.parentNotFound': 'Zone parente introuvable.',
  'areas.repositoryFailed': "L'operation sur la zone a echoue.",
  'areas.selfParent': 'Une zone ne peut pas etre sa propre parente.',
  'audit.writeFailed': "L'ecriture du journal d'audit a echoue.",
  'auditLogs.notFound': "Journal d'audit introuvable.",
  'auditLogs.repositoryFailed': "L'operation sur le journal d'audit a echoue.",
  'auth.permissionDenied': 'Permissions insuffisantes.',
  'auth.unauthorized': 'Non autorise.',
  'email.sendFailed': "L'envoi de l'e-mail a echoue.",
  'email.welcomeRequestFailed':
    "La demande d'e-mail de bienvenue a echoue.",
  'tenant.membershipRejected':
    "Le tenant actif n'est pas disponible pour cet utilisateur.",
  'tenant.notResolved':
    'Aucun tenant actif na pu etre resolu pour cette requete.',
  'tenant.hostNotFound': 'Hote tenant introuvable.',
  'branding.repositoryFailed': "L'operation de branding a echoue.",
  'branding.sessionUserUnavailable':
    "L'utilisateur de session n'est pas disponible.",
  'categories.circularReference':
    'Impossible de definir cette categorie parente car cela creerait une reference circulaire.',
  'categories.deleted': 'Categorie supprimee avec succes.',
  'categories.nameAlreadyExists': 'Une categorie avec ce nom existe deja.',
  'categories.notFound': 'Categorie introuvable.',
  'categories.parentNotFound': 'Categorie parente introuvable.',
  'categories.repositoryFailed': "L'operation sur la categorie a echoue.",
  'categories.selfParent': 'Une categorie ne peut pas etre sa propre parente.',
  'clients.deleted': 'Client supprime avec succes.',
  'clients.emailAlreadyExists':
    'Un client avec cette adresse e-mail existe deja.',
  'clients.notFound': 'Client introuvable.',
  'clients.repositoryFailed': "L'operation sur le client a echoue.",
  'db.query': 'Requete base de donnees executee.',
  'drizzle.initializationFailed':
    "Echec de l'initialisation de la connexion a la base de donnees.",
  'drizzle.migrationsFailed':
    "Echec de l'execution des migrations Better Auth.",
  'errors.internalServerError': 'Erreur interne du serveur.',
  'fulfillment.infrastructureFailed': "L'operation de preparation a echoue.",
  'fulfillment.insufficientInventory':
    'Stock insuffisant pour effectuer le prelevement.',
  'fulfillment.notPickable':
    'La commande doit deja etre confirmee ou en preparation.',
  'fulfillment.onlyDraftCanConfirm':
    'Seules les commandes brouillon peuvent etre confirmees.',
  'fulfillment.orderItemNotFound': 'Ligne de commande introuvable.',
  'fulfillment.orderNotFound': 'Commande introuvable.',
  'fulfillment.overPick':
    'La quantite prelevee depasserait la quantite commandee.',
  'fulfillment.packNotImplemented':
    "L'emballage n'est pas encore implemente dans le flux de preparation.",
  'fulfillment.shipNotImplemented':
    "L'expedition n'est pas encore implementee dans le flux de preparation.",
  'health.betterAuthConfigured': 'Better Auth est correctement configure.',
  'health.betterAuthSecretMissing': 'BETTER_AUTH_SECRET nest pas configure.',
  'health.databaseUnreachable': 'La base de donnees est inaccessible.',
  'http.parseError': 'Charge utile invalide : {details}',
  'http.request': 'Requete HTTP terminee.',
  'http.requestBodyTooLarge':
    'Le corps de la requete depasse la limite de 10 Mo.',
  'http.requestError': 'Requete invalide : {details}',
  'http.routeNotFound': 'Impossible de {method} {path}.',
  'http.serverError': 'Erreur serveur HTTP.',
  'http.unexpectedError': 'Erreur inattendue : {details}',
  'inventory.alreadyExists':
    'Un stock existe deja pour ce produit et cet emplacement.',
  'inventory.areaLocationMismatch':
    'La zone selectionnee doit appartenir a lemplacement selectionne.',
  'inventory.areaNotFound': 'Zone introuvable.',
  'inventory.deleted': 'Element de stock supprime avec succes.',
  'inventory.infrastructureFailed': "L'operation de stock a echoue.",
  'inventory.locationNotFound': 'Emplacement introuvable.',
  'inventory.notFound': 'Element de stock introuvable.',
  'inventory.productNotFound': 'Produit introuvable.',
  'inventory.quantityAdjustmentNegative':
    'Lajustement de stock produirait une quantite negative.',
  'locations.deleted': 'Emplacement supprime avec succes.',
  'locations.notFound': 'Emplacement introuvable.',
  'locations.repositoryFailed': "L'operation sur lemplacement a echoue.",
  'orders.clientNotFound': 'Client introuvable.',
  'orders.deleteOnlyDraft':
    'Seules les commandes brouillon peuvent etre supprimees.',
  'orders.deleted': 'Commande supprimee avec succes.',
  'orders.infrastructureFailed': "L'operation sur la commande a echoue.",
  'orders.invalidStatusTransition':
    'Transition impossible de {from} vers {to}.',
  'orders.notFound': 'Commande introuvable.',
  'orders.productNotFound': 'Produit introuvable.',
  'photos.deleted': 'Photo supprimee avec succes.',
  'photos.deleteFailed': 'La suppression du fichier photo a echoue.',
  'photos.existenceCheckFailed':
    'La verification de lexistence de la photo a echoue.',
  'photos.fileNotFound': 'Le fichier photo est introuvable sur le disque.',
  'photos.invalidMimeType':
    'Type de fichier invalide. Types autorises : {allowedTypes}.',
  'photos.notFound': 'Photo introuvable.',
  'photos.readUploadFailed': 'La lecture du fichier televerse a echoue.',
  'photos.repositoryFailed': "L'operation sur la photo a echoue.",
  'photos.statUploadFailed':
    'La lecture des metadonnees du fichier televerse a echoue.',
  'photos.tooLarge':
    'Le fichier est trop volumineux. Taille maximale autorisee : {maxSize} octets.',
  'photos.writeFailed': "L'ecriture du fichier photo a echoue.",
  'platform.hostRequired': 'La route plateforme est introuvable pour cet hote.',
  'products.categoryNotFound': 'Categorie introuvable.',
  'products.createdProductLoadFailed':
    'Le chargement du produit cree a echoue.',
  'products.deleted': 'Produit supprime avec succes.',
  'products.deletedPermanent': 'Produit supprime definitivement.',
  'products.importAreaScopedInventoryConflict':
    "Impossible d'importer un stock au niveau emplacement lorsqu'un stock par zone existe deja pour ce produit et cet emplacement.",
  'products.importCsvParseFailed':
    "Impossible d'analyser le fichier CSV televerse.",
  'products.importReadUploadFailed':
    "La lecture du fichier d'import produits televerse a echoue.",
  'products.importUnsupportedFormat':
    'En-tetes CSV dimport produits non pris en charge.',
  'products.infrastructureFailed': "L'operation sur le produit a echoue.",
  'products.notDeleted': 'Le produit nest pas supprime.',
  'products.notFound': 'Produit introuvable.',
  'products.priceBelowCost':
    'Le prix standard doit etre superieur ou egal au cout standard.',
  'products.repositoryFailed': "L'operation sur le produit a echoue.",
  'products.skuAlreadyExists': 'Un produit avec ce SKU existe deja.',
  'roles.infrastructureFailed': "L'operation sur le role a echoue.",
  'roles.loadPermissionsFailed':
    'Le chargement des permissions utilisateur a echoue.',
  'roles.nameAlreadyExists': 'Un role avec ce nom existe deja.',
  'roles.notFound': 'Role introuvable.',
  'roles.repositoryFailed': "L'operation sur le role a echoue.",
  'roles.systemDeletionForbidden':
    'Les roles systeme ne peuvent pas etre supprimes.',
  'session.resolveFailed': 'La resolution de la session utilisateur a echoue.',
  'superadmin.forbidden': "L'acces superadmin est requis.",
  'superadmin.invalidTenantSlug': 'Le slug tenant est invalide.',
  'superadmin.infrastructureFailed': "L'autorisation superadmin a echoue.",
  'superadmin.repositoryFailed': "L'operation superadmin a echoue.",
  'superadmin.reservedTenantSlug': 'Le slug tenant est reserve.',
  'superadmin.tenantHostnameAlreadyExists':
    'Un tenant avec cet hote existe deja.',
  'superadmin.tenantSlugAlreadyExists': 'Un tenant avec ce slug existe deja.',
  'stockMovements.destinationLocationNotFound':
    'Emplacement de destination introuvable.',
  'stockMovements.infrastructureFailed':
    "L'operation sur le mouvement de stock a echoue.",
  'stockMovements.locationNotFound': 'Emplacement introuvable.',
  'stockMovements.notFound': 'Mouvement de stock introuvable.',
  'stockMovements.orderNotFound': 'Commande introuvable.',
  'stockMovements.productNotFound': 'Produit introuvable.',
  'stockMovements.repositoryFailed':
    "L'operation sur le mouvement de stock a echoue.",
  'stockMovements.sourceLocationNotFound': 'Emplacement source introuvable.',
  'suppliers.deleted': 'Fournisseur supprime avec succes.',
  'suppliers.notFound': 'Fournisseur introuvable.',
  'suppliers.repositoryFailed': "L'operation sur le fournisseur a echoue.",
  'users.infrastructureFailed': "L'operation sur l'utilisateur a echoue.",
  'users.notFound': 'Utilisateur introuvable.',
  'users.repositoryFailed': "L'operation sur l'utilisateur a echoue.",
};

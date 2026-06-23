import type { MessageKey } from './en';

export const deCatalog: Record<MessageKey, string> = {
  'areas.circularReference':
    'Der Elternbereich kann nicht gesetzt werden, weil dadurch ein Zirkelbezug entstuende.',
  'areas.deleted': 'Bereich erfolgreich geloescht.',
  'areas.locationNotFound': 'Standort nicht gefunden.',
  'areas.notFound': 'Bereich nicht gefunden.',
  'areas.parentLocationMismatch':
    'Der Elternbereich muss zum selben Standort gehoeren.',
  'areas.parentNotFound': 'Elternbereich nicht gefunden.',
  'areas.repositoryFailed': 'Der Bereichsvorgang ist fehlgeschlagen.',
  'areas.selfParent': 'Ein Bereich kann nicht sein eigener Elternbereich sein.',
  'audit.writeFailed': 'Das Schreiben des Audit-Logs ist fehlgeschlagen.',
  'auditLogs.notFound': 'Audit-Log nicht gefunden.',
  'auditLogs.repositoryFailed': 'Der Audit-Log-Vorgang ist fehlgeschlagen.',
  'auth.permissionDenied': 'Unzureichende Berechtigungen.',
  'auth.unauthorized': 'Nicht autorisiert.',
  'email.sendFailed': 'Der E-Mail-Versand ist fehlgeschlagen.',
  'email.welcomeRequestFailed':
    'Die Anforderung der Willkommens-E-Mail ist fehlgeschlagen.',
  'tenant.membershipRejected':
    'Der aktive Tenant ist fuer diesen Benutzer nicht verfuegbar.',
  'tenant.notResolved':
    'Fuer diese Anfrage konnte kein aktiver Tenant ermittelt werden.',
  'tenant.hostNotFound': 'Tenant-Host nicht gefunden.',
  'branding.repositoryFailed': 'Der Branding-Vorgang ist fehlgeschlagen.',
  'branding.sessionUserUnavailable':
    'Der Sitzungsbenutzer ist nicht verfuegbar.',
  'categories.circularReference':
    'Die Elternkategorie kann nicht gesetzt werden, weil dadurch ein Zirkelbezug entstuende.',
  'categories.deleted': 'Kategorie erfolgreich geloescht.',
  'categories.nameAlreadyExists':
    'Eine Kategorie mit diesem Namen existiert bereits.',
  'categories.notFound': 'Kategorie nicht gefunden.',
  'categories.parentNotFound': 'Elternkategorie nicht gefunden.',
  'categories.repositoryFailed': 'Der Kategorienvorgang ist fehlgeschlagen.',
  'categories.selfParent':
    'Eine Kategorie kann nicht ihre eigene Elternkategorie sein.',
  'clients.deleted': 'Kunde erfolgreich geloescht.',
  'clients.emailAlreadyExists':
    'Ein Kunde mit dieser E-Mail-Adresse existiert bereits.',
  'clients.notFound': 'Kunde nicht gefunden.',
  'clients.repositoryFailed': 'Der Kundenvorgang ist fehlgeschlagen.',
  'db.query': 'Datenbankabfrage ausgefuehrt.',
  'drizzle.initializationFailed':
    'Die Initialisierung der Datenbankverbindung ist fehlgeschlagen.',
  'drizzle.migrationsFailed':
    'Die Better-Auth-Migrationen konnten nicht ausgefuehrt werden.',
  'errors.internalServerError': 'Interner Serverfehler.',
  'features.notEnabled':
    'Diese Funktion ist fuer den aktiven Tenant nicht aktiviert.',
  'features.repositoryFailed':
    'Der Vorgang fuer Feature-Berechtigungen ist fehlgeschlagen.',
  'features.tenantNotFound': 'Tenant nicht gefunden.',
  'fulfillment.infrastructureFailed':
    'Der Fulfillment-Vorgang ist fehlgeschlagen.',
  'fulfillment.insufficientInventory':
    'Nicht genug Bestand fuer die Kommissionierung vorhanden.',
  'fulfillment.notPickable':
    'Die Bestellung muss bestaetigt oder bereits in Kommissionierung sein.',
  'fulfillment.onlyDraftCanConfirm':
    'Nur Entwurfsbestellungen koennen bestaetigt werden.',
  'fulfillment.orderItemNotFound': 'Bestellposition nicht gefunden.',
  'fulfillment.orderNotFound': 'Bestellung nicht gefunden.',
  'fulfillment.overPick':
    'Die kommissionierte Menge wuerde die bestellte Menge ueberschreiten.',
  'fulfillment.packNotImplemented':
    'Das Verpacken ist im Fulfillment-Ablauf noch nicht implementiert.',
  'fulfillment.shipNotImplemented':
    'Der Versand ist im Fulfillment-Ablauf noch nicht implementiert.',
  'health.betterAuthConfigured': 'Better Auth ist korrekt konfiguriert.',
  'health.betterAuthSecretMissing':
    'BETTER_AUTH_SECRET ist nicht konfiguriert.',
  'health.databaseUnreachable': 'Die Datenbank ist nicht erreichbar.',
  'http.parseError': 'Ungueltige Anfrage-Nutzlast: {details}',
  'http.request': 'HTTP-Anfrage abgeschlossen.',
  'http.requestBodyTooLarge': 'Der Anfragetext ueberschreitet das 10-MB-Limit.',
  'http.requestError': 'Ungueltige Anfrage: {details}',
  'http.routeNotFound': '{method} {path} kann nicht ausgefuehrt werden.',
  'http.serverError': 'HTTP-Serverfehler.',
  'http.unexpectedError': 'Unerwarteter Fehler: {details}',
  'inventory.alreadyExists':
    'Bestand fuer dieses Produkt und diesen Standort existiert bereits.',
  'inventory.areaLocationMismatch':
    'Der ausgewaehlte Bereich muss zum ausgewaehlten Standort gehoeren.',
  'inventory.areaNotFound': 'Bereich nicht gefunden.',
  'inventory.deleted': 'Bestandseintrag erfolgreich geloescht.',
  'inventory.infrastructureFailed': 'Der Bestandsvorgang ist fehlgeschlagen.',
  'inventory.locationNotFound': 'Standort nicht gefunden.',
  'inventory.notFound': 'Bestandseintrag nicht gefunden.',
  'inventory.productNotFound': 'Produkt nicht gefunden.',
  'inventory.quantityAdjustmentNegative':
    'Die Bestandsanpassung wuerde zu einer negativen Menge fuehren.',
  'locations.deleted': 'Standort erfolgreich geloescht.',
  'locations.notFound': 'Standort nicht gefunden.',
  'locations.repositoryFailed': 'Der Standortvorgang ist fehlgeschlagen.',
  'notifications.preferencesUpdated':
    'Benachrichtigungseinstellungen aktualisiert.',
  'notifications.repositoryFailed':
    'Der Benachrichtigungsvorgang ist fehlgeschlagen.',
  'notifications.sendFailed':
    'Die Benachrichtigungszustellung ist fehlgeschlagen.',
  'orders.clientNotFound': 'Kunde nicht gefunden.',
  'orders.deleteOnlyDraft':
    'Nur Entwurfsbestellungen koennen geloescht werden.',
  'orders.deleted': 'Bestellung erfolgreich geloescht.',
  'orders.infrastructureFailed': 'Der Bestellvorgang ist fehlgeschlagen.',
  'orders.invalidStatusTransition':
    'Uebergang von {from} nach {to} ist nicht erlaubt.',
  'orders.notFound': 'Bestellung nicht gefunden.',
  'orders.productNotFound': 'Produkt nicht gefunden.',
  'photos.deleted': 'Foto erfolgreich geloescht.',
  'photos.deleteFailed': 'Das Fotoobjekt konnte nicht geloescht werden.',
  'photos.existenceCheckFailed':
    'Die Pruefung auf das Vorhandensein des Fotos ist fehlgeschlagen.',
  'photos.fileNotFound': 'Fotoobjekt im Speicher nicht gefunden.',
  'photos.invalidMimeType':
    'Ungueltiger Dateityp. Erlaubte Typen: {allowedTypes}.',
  'photos.notFound': 'Foto nicht gefunden.',
  'photos.readFailed': 'Das Fotoobjekt konnte nicht gelesen werden.',
  'photos.readUploadFailed':
    'Die hochgeladene Datei konnte nicht gelesen werden.',
  'photos.repositoryFailed': 'Der Fotovorgang ist fehlgeschlagen.',
  'photos.statUploadFailed':
    'Die Metadaten der hochgeladenen Datei konnten nicht gelesen werden.',
  'photos.tooLarge':
    'Die Datei ist zu gross. Maximal zulaessige Groesse: {maxSize} Byte.',
  'photos.writeFailed': 'Das Fotoobjekt konnte nicht geschrieben werden.',
  'platform.hostRequired':
    'Die Plattformroute wurde fuer diesen Host nicht gefunden.',
  'products.categoryNotFound': 'Kategorie nicht gefunden.',
  'products.createdProductLoadFailed':
    'Das neu erstellte Produkt konnte nicht geladen werden.',
  'products.deleted': 'Produkt erfolgreich geloescht.',
  'products.deletedPermanent': 'Produkt dauerhaft geloescht.',
  'products.importAreaScopedInventoryConflict':
    'Standortbestand kann nicht importiert werden, solange fuer dieses Produkt und diesen Standort bereichsbezogener Bestand existiert.',
  'products.importCsvParseFailed':
    'Die hochgeladene CSV-Datei konnte nicht geparst werden.',
  'products.importReadUploadFailed':
    'Die hochgeladene Produktimportdatei konnte nicht gelesen werden.',
  'products.importUnsupportedFormat':
    'Nicht unterstuetzte CSV-Kopfzeilen fuer den Produktimport.',
  'products.infrastructureFailed': 'Der Produktvorgang ist fehlgeschlagen.',
  'products.notDeleted': 'Das Produkt ist nicht geloescht.',
  'products.notFound': 'Produkt nicht gefunden.',
  'products.priceBelowCost':
    'Der Standardpreis muss groesser oder gleich den Standardkosten sein.',
  'products.repositoryFailed': 'Der Produktvorgang ist fehlgeschlagen.',
  'products.skuAlreadyExists': 'Ein Produkt mit dieser SKU existiert bereits.',
  'roles.infrastructureFailed': 'Der Rollenvorgang ist fehlgeschlagen.',
  'roles.loadPermissionsFailed':
    'Die Benutzerberechtigungen konnten nicht geladen werden.',
  'roles.nameAlreadyExists': 'Eine Rolle mit diesem Namen existiert bereits.',
  'roles.notFound': 'Rolle nicht gefunden.',
  'roles.repositoryFailed': 'Der Rollenvorgang ist fehlgeschlagen.',
  'roles.systemDeletionForbidden':
    'Systemrollen koennen nicht geloescht werden.',
  'session.resolveFailed':
    'Die Aufloesung der Benutzersitzung ist fehlgeschlagen.',
  'superadmin.forbidden': 'Superadmin-Zugriff ist erforderlich.',
  'superadmin.invalidTenantSlug': 'Der Tenant-Slug ist ungueltig.',
  'superadmin.infrastructureFailed':
    'Die Superadmin-Autorisierung ist fehlgeschlagen.',
  'superadmin.repositoryFailed': 'Der Superadmin-Vorgang ist fehlgeschlagen.',
  'superadmin.reservedTenantSlug': 'Der Tenant-Slug ist reserviert.',
  'superadmin.tenantImportInvalid':
    'Die ausgewaehlte Importdatei kann nicht importiert werden: {details}',
  'superadmin.tenantImportReadFailed':
    'Die ausgewaehlte Tenant-Importdatei konnte nicht gelesen werden.',
  'superadmin.tenantHostnameAlreadyExists':
    'Ein Tenant mit diesem Hostnamen existiert bereits.',
  'superadmin.tenantSlugAlreadyExists':
    'Ein Tenant mit diesem Slug existiert bereits.',
  'stockMovements.destinationLocationNotFound': 'Zielstandort nicht gefunden.',
  'stockMovements.infrastructureFailed':
    'Der Lagerbewegungsvorgang ist fehlgeschlagen.',
  'stockMovements.locationNotFound': 'Standort nicht gefunden.',
  'stockMovements.notFound': 'Lagerbewegung nicht gefunden.',
  'stockMovements.orderNotFound': 'Bestellung nicht gefunden.',
  'stockMovements.productNotFound': 'Produkt nicht gefunden.',
  'stockMovements.repositoryFailed':
    'Der Lagerbewegungsvorgang ist fehlgeschlagen.',
  'stockMovements.sourceLocationNotFound': 'Quellstandort nicht gefunden.',
  'suppliers.deleted': 'Lieferant erfolgreich geloescht.',
  'suppliers.notFound': 'Lieferant nicht gefunden.',
  'suppliers.repositoryFailed': 'Der Lieferantenvorgang ist fehlgeschlagen.',
  'users.infrastructureFailed': 'Der Benutzervorgang ist fehlgeschlagen.',
  'users.notFound': 'Benutzer nicht gefunden.',
  'users.repositoryFailed': 'Der Benutzervorgang ist fehlgeschlagen.',
};

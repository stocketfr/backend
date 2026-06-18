CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE TYPE "public"."audit_logs_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'ADJUST_QUANTITY', 'ADD_PHOTO', 'STATUS_CHANGE');
CREATE TYPE "public"."audit_logs_entity_type" AS ENUM('PRODUCT', 'CATEGORY', 'SUPPLIER', 'ORDER', 'ORDER_ITEM', 'INVENTORY', 'LOCATION', 'STOCK_MOVEMENT', 'PHOTO', 'AREA', 'CLIENT', 'ROLE');
CREATE TYPE "public"."clients_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "public"."locations_type" AS ENUM('WAREHOUSE', 'SUPPLIER', 'IN_TRANSIT', 'CLIENT');
CREATE TYPE "public"."orders_status" AS ENUM('DRAFT', 'CONFIRMED', 'SOURCING', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'ON_HOLD');
CREATE TYPE "public"."stock_movements_reason" AS ENUM('PURCHASE_RECEIVE', 'SALE', 'WASTE', 'DAMAGED', 'EXPIRED', 'COUNT_CORRECTION', 'RETURN_FROM_CLIENT', 'RETURN_TO_SUPPLIER', 'INTERNAL_TRANSFER');
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"location_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text,
	"action" "audit_logs_action" NOT NULL,
	"entity_type" "audit_logs_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"changes" jsonb,
	"ip_address" varchar,
	"user_agent" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "branding_settings" (
	"id" integer DEFAULT 1 NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"tagline" varchar(255) NOT NULL,
	"logo_url" varchar(500),
	"favicon_url" varchar(500),
	"primary_color" varchar(7) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar,
	CONSTRAINT "branding_settings_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);

CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(100) NOT NULL,
	"parent_id" uuid,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"company_name" varchar NOT NULL,
	"yacht_name" varchar,
	"contact_person" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"billing_address" text,
	"default_delivery_address" text,
	"account_status" "clients_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"payment_terms" varchar,
	"credit_limit" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"area_id" uuid,
	"quantity" integer DEFAULT 0 NOT NULL,
	"batch_number" varchar DEFAULT '' NOT NULL,
	"expiry_date" timestamp with time zone,
	"cost_per_unit" numeric(12, 2),
	"received_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar NOT NULL,
	"type" "locations_type" NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"contact_person" varchar DEFAULT '' NOT NULL,
	"phone" varchar DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"notes" text,
	"quantity_picked" integer DEFAULT 0 NOT NULL,
	"quantity_packed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"order_number" varchar NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "orders_status" DEFAULT 'DRAFT' NOT NULL,
	"delivery_deadline" timestamp with time zone,
	"delivery_address" text NOT NULL,
	"yacht_name" varchar,
	"special_instructions" text,
	"total_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"kanban_task_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"locale" text,
	CONSTRAINT "user_email_key" UNIQUE("email")
);

CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_key" UNIQUE("token")
);

CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);

CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"kind" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_domains_kind_check" CHECK ("kind" IN ('subdomain', 'custom_domain'))
);

CREATE TABLE "super_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text NOT NULL,
	"category" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text NOT NULL,
	"event_kind" varchar(50) NOT NULL,
	"category" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"dedupe_key" text,
	"status" varchar(20) NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);

CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mimetype" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"sku" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"volume_ml" integer,
	"weight_kg" numeric(10, 3),
	"dimensions_cm" varchar(50),
	"standard_cost" numeric(12, 2),
	"standard_price" numeric(12, 2),
	"markup_percentage" numeric(6, 2),
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"primary_supplier_id" uuid,
	"supplier_sku" varchar(50),
	"barcode" varchar(100),
	"unit" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" varchar(255),
	"updated_by" varchar(255),
	"deleted_by" varchar(255)
);

CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"resource" varchar(50) NOT NULL,
	"permission" varchar(20) NOT NULL
);

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"product_id" uuid NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity" integer NOT NULL,
	"reason" "stock_movements_reason" NOT NULL,
	"order_id" uuid,
	"reference_number" varchar,
	"cost_per_unit" numeric(12, 2),
	"kanban_task_id" varchar,
	"user_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_sku" varchar,
	"cost_per_unit" numeric(12, 2),
	"lead_time_days" integer,
	"minimum_order_quantity" integer,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar NOT NULL,
	"contact_person" varchar,
	"email" varchar,
	"phone" varchar,
	"address" text,
	"website" varchar,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL
);

ALTER TABLE "areas" ADD CONSTRAINT "areas_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "photos" ADD CONSTRAINT "photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_primary_supplier_id_suppliers_id_fk" FOREIGN KEY ("primary_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");
CREATE INDEX "areas_tenant_id_idx" ON "areas" USING btree ("tenant_id");
CREATE INDEX "areas_location_id_idx" ON "areas" USING btree ("location_id");
CREATE INDEX "areas_parent_id_idx" ON "areas" USING btree ("parent_id");
CREATE INDEX "areas_location_parent_idx" ON "areas" USING btree ("location_id","parent_id");
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs" USING btree ("tenant_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");
CREATE INDEX "categories_tenant_id_idx" ON "categories" USING btree ("tenant_id");
CREATE INDEX "clients_tenant_id_idx" ON "clients" USING btree ("tenant_id");
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");
CREATE INDEX "clients_account_status_idx" ON "clients" USING btree ("account_status");
CREATE INDEX "inventory_tenant_id_idx" ON "inventory" USING btree ("tenant_id");
CREATE INDEX "inventory_product_id_idx" ON "inventory" USING btree ("product_id");
CREATE INDEX "inventory_location_id_idx" ON "inventory" USING btree ("location_id");
CREATE INDEX "inventory_area_id_idx" ON "inventory" USING btree ("area_id");
CREATE INDEX "inventory_product_location_idx" ON "inventory" USING btree ("product_id","location_id");
CREATE INDEX "inventory_product_location_area_idx" ON "inventory" USING btree ("product_id","location_id","area_id");
CREATE INDEX "locations_tenant_id_idx" ON "locations" USING btree ("tenant_id");
CREATE UNIQUE INDEX "member_user_organization_unique" ON "member" USING btree ("user_id","organization_id");
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");
CREATE INDEX "member_organization_id_idx" ON "member" USING btree ("organization_id");
CREATE UNIQUE INDEX "notification_preferences_unique" ON "notification_preferences" USING btree ("tenant_id","user_id","category","channel");
CREATE INDEX "notification_preferences_tenant_user_idx" ON "notification_preferences" USING btree ("tenant_id","user_id");
CREATE INDEX "notification_preferences_audience_idx" ON "notification_preferences" USING btree ("tenant_id","category","channel");
CREATE INDEX "notifications_tenant_user_idx" ON "notifications" USING btree ("tenant_id","user_id");
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");
CREATE UNIQUE INDEX "notifications_dedupe_key_unique" ON "notifications" USING btree ("dedupe_key") WHERE dedupe_key is not null;
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");
CREATE UNIQUE INDEX "orders_tenant_order_number_unique" ON "orders" USING btree ("tenant_id","order_number");
CREATE INDEX "orders_client_id_idx" ON "orders" USING btree ("client_id");
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");
CREATE UNIQUE INDEX "organization_slug_unique" ON "organization" USING btree ("slug");
CREATE UNIQUE INDEX "tenant_domains_hostname_unique" ON "tenant_domains" USING btree ("hostname");
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains" USING btree ("tenant_id");
CREATE UNIQUE INDEX "tenant_domains_one_primary_per_tenant_idx" ON "tenant_domains" USING btree ("tenant_id") WHERE "is_primary" = true;
CREATE INDEX "platform_audit_events_actor_user_id_idx" ON "platform_audit_events" USING btree ("actor_user_id");
CREATE INDEX "platform_audit_events_created_at_idx" ON "platform_audit_events" USING btree ("created_at");
CREATE INDEX "photos_product_id_idx" ON "photos" USING btree ("product_id");
CREATE UNIQUE INDEX "products_tenant_sku_unique" ON "products" USING btree ("tenant_id","sku");
CREATE INDEX "products_deleted_at_idx" ON "products" USING btree ("deleted_at");
CREATE INDEX "products_active_deleted_idx" ON "products" USING btree ("is_active","deleted_at");
CREATE INDEX "products_category_deleted_idx" ON "products" USING btree ("category_id","deleted_at");
CREATE UNIQUE INDEX "role_permissions_role_resource_permission_unique" ON "role_permissions" USING btree ("role_id","resource","permission");
CREATE UNIQUE INDEX "roles_tenant_name_unique" ON "roles" USING btree ("tenant_id","name");
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers" USING btree ("tenant_id");
CREATE INDEX "stock_movements_tenant_id_idx" ON "stock_movements" USING btree ("tenant_id");
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements" USING btree ("product_id");
CREATE INDEX "stock_movements_from_location_id_idx" ON "stock_movements" USING btree ("from_location_id");
CREATE INDEX "stock_movements_to_location_id_idx" ON "stock_movements" USING btree ("to_location_id");
CREATE INDEX "stock_movements_reason_idx" ON "stock_movements" USING btree ("reason");
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements" USING btree ("created_at");
CREATE UNIQUE INDEX "user_roles_tenant_user_role_unique" ON "user_roles" USING btree ("tenant_id","user_id","role_id");
CREATE INDEX "user_roles_user_id_idx" ON "user_roles" USING btree ("user_id");
CREATE INDEX "user_roles_tenant_user_id_idx" ON "user_roles" USING btree ("tenant_id","user_id");

INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
SELECT
  o.id,
  lower(trim(trailing '.' from o.slug)) || '.stocket.fr',
  'subdomain',
  true,
  now()
FROM organization o
WHERE lower(trim(trailing '.' from o.slug)) NOT IN (
    'default',
    'api',
    'deploy',
    'www',
    'admin',
    'superadmin',
    'auth',
    'assets'
  )
ON CONFLICT (hostname) DO NOTHING;

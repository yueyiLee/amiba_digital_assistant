CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"level1" text NOT NULL,
	"level2" text DEFAULT '',
	"owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "contract_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer,
	"product_id" integer,
	"quantity" real DEFAULT 0,
	"actual_price" real DEFAULT 0,
	"amount" real DEFAULT 0,
	"owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "contract_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer,
	"service_id" integer,
	"service_name" text DEFAULT '',
	"amount" real DEFAULT 0,
	"owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_no" text NOT NULL,
	"customer_id" integer,
	"amount" real DEFAULT 0,
	"status" text DEFAULT '进行中',
	"start_date" text DEFAULT '',
	"end_date" text DEFAULT '',
	"date" text DEFAULT '',
	"direction" text DEFAULT 'sale',
	"note" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT '个人',
	"contact" text DEFAULT '',
	"address" text DEFAULT '',
	"notes" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"status" text NOT NULL,
	"change_type" text DEFAULT '',
	"position" text DEFAULT '',
	"hourly_rate" real DEFAULT 0,
	"changed_date" text NOT NULL,
	"note" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" text DEFAULT '',
	"hourly_rate" real DEFAULT 0,
	"join_date" text DEFAULT '',
	"status" text DEFAULT 'active',
	"leave_date" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '',
	"owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "expense_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"direction" text DEFAULT 'expense' NOT NULL,
	"link_customer" boolean DEFAULT true,
	"link_product" boolean DEFAULT true,
	"link_cat" text DEFAULT '',
	"enabled" boolean DEFAULT true,
	"parent_id" integer,
	"owner_id" integer,
	CONSTRAINT "expense_types_owner_id_name_direction_unique" UNIQUE("owner_id","name","direction")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"quantity" real DEFAULT 0,
	"avg_price" real DEFAULT 0,
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text DEFAULT '',
	"unit" text DEFAULT '件',
	"category1" text DEFAULT '',
	"category2" text DEFAULT '',
	"purchase_price" real DEFAULT 0,
	"sale_price" real DEFAULT 0,
	"notes" text DEFAULT '',
	"warning_threshold" real DEFAULT 0,
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "salaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"amount" real DEFAULT 0,
	"month" text DEFAULT '',
	"owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"reference_cost" real DEFAULT 0,
	"note" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"owner_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '',
	CONSTRAINT "settings_owner_id_key_pk" PRIMARY KEY("owner_id","key")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" real NOT NULL,
	"type" text NOT NULL,
	"unit" text DEFAULT '全公司',
	"customer_id" integer,
	"product_id" integer,
	"contract_id" integer,
	"date" text NOT NULL,
	"note" text DEFAULT '',
	"category" text DEFAULT '',
	"owner_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text DEFAULT '',
	"role" text DEFAULT 'viewer',
	"company_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "work_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"hours" real DEFAULT 0,
	"month" text NOT NULL,
	"owner_id" integer,
	CONSTRAINT "work_hours_employee_id_month_unique" UNIQUE("employee_id","month")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_services" ADD CONSTRAINT "contract_services_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_services" ADD CONSTRAINT "contract_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_services" ADD CONSTRAINT "contract_services_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_types" ADD CONSTRAINT "expense_types_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_hours" ADD CONSTRAINT "work_hours_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_hours" ADD CONSTRAINT "work_hours_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
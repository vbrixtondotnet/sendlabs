CREATE TABLE `system_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`html_body` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "system_templates_name_chk" CHECK(length(trim("name")) > 0 AND length("name") <= 100),
	CONSTRAINT "system_templates_body_chk" CHECK(length(trim("html_body")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_templates_name_uq` ON `system_templates` (lower("name"));
--> statement-breakpoint
-- Seeds the Available Templates with the nine from the "Email Templates" folder. Their ids are stable slugs, which the
-- tenants' copies (email_templates.builtin_key) already refer to.
INSERT INTO `system_templates` (`id`, `name`, `html_body`, `created_at`, `updated_at`) VALUES
  ('automotive-services', 'Automotive Services', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the automotive services your business provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, paper-based service records, manual data entry, or disconnected applications to manage customer information, vehicle service histories, repair orders, parts inventory, and day-to-day shop operations?</p>

<p>Are some of your critical business processes still running on outdated automotive management software or legacy systems that make it difficult to track repair jobs, monitor parts availability, manage service schedules, and get a clear picture of your business performance?</p>

<p>These are common challenges among growing automotive service businesses, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help automotive service businesses modernize their operations through custom-built automotive management systems, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your automotive business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Service Management</strong> – Streamline service appointments, repair orders, job assignments, service workflows, and vehicle maintenance records.</li>

    <li><strong>Improve Vehicle Service History Tracking</strong> – Maintain centralized vehicle profiles, maintenance records, repair histories, inspection results, and service schedules.</li>

    <li><strong>Automate Parts and Inventory Management</strong> – Track automotive parts, supplies, stock levels, inventory movements, and purchase orders.</li>

    <li><strong>Streamline Billing and Invoicing</strong> – Automate service estimates, repair invoices, labor charges, parts billing, and payment tracking.</li>

    <li><strong>Improve Customer Management</strong> – Centralize customer profiles, vehicle information, service histories, communications, and follow-up reminders.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent document processing, automated service reminders, operational insights, and AI-powered administrative workflows.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your automotive management platform with accounting applications, CRM systems, payment gateways, and other business tools to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Automotive Operations.</strong></p>

<p>We understand that automotive service businesses cannot simply stop accepting vehicles, handling repairs, managing customer appointments, or processing transactions while transitioning to new technology.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern automotive business technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your automotive management software should adapt to your business processes, not force your team to change the way it operates.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline service management, improve parts inventory tracking, automate administrative tasks, and modernize existing business operations.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('construction', 'Construction', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the construction projects your company handles.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual data entry, or disconnected applications to manage project estimates, job costs, schedules, and day-to-day construction operations?</p>

<p>Are some of your critical business processes still running on outdated construction management software or legacy systems that make it difficult to get accurate, real-time visibility into your projects?</p>

<p>These are common challenges among growing construction companies, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help construction companies modernize their operations through custom-built construction management systems, business process automation, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your construction business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Project Estimating</strong> – Streamline project proposals, estimates, change orders, and budget revisions.</li>
    <li><strong>Improve Job Cost Management</strong> – Track estimated costs against actual expenses and gain better visibility into project profitability.</li>
    <li><strong>Streamline Project Scheduling</strong> – Organize project timelines, milestones, tasks, and resource allocation.</li>
    <li><strong>Centralize Project Information</strong> – Keep project documents, communications, activities, and important records in one place.</li>
    <li><strong>Automate Administrative Work</strong> – Reduce repetitive data entry, manual reporting, and time-consuming processes.</li>
    <li><strong>Leverage AI</strong> – Introduce intelligent workflows, automated document processing, and AI-powered business insights.</li>
    <li><strong>Integrate Existing Systems</strong> – Connect your construction management platform with accounting applications like QuickBooks and other business tools.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Construction Operations.</strong></p>

<p>We understand that you cannot simply stop managing active projects while transitioning to new technology. That''s why we take a gradual, well-planned modernization approach that allows your team to continue working while your business processes and systems evolve.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern construction technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your construction management software should adapt to your business, not force your team to change the way they work.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline project management, improve cost visibility, and modernize existing business operations.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('digital-marketing', 'Digital Marketing', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the digital marketing services your team provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual reporting, and multiple disconnected tools to manage marketing campaigns, client accounts, leads, and day-to-day operations?</p>

<p>Are your team members spending valuable hours on repetitive administrative tasks, compiling campaign performance reports, managing client data, or moving information between different marketing platforms?</p>

<p>These are common challenges among growing digital marketing agencies, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help digital marketing agencies modernize their operations through custom-built software, business process automation, system integrations, and AI-driven solutions.</p>

<p>We develop solutions designed around how your agency actually operates, helping you:</p>

<ul>
    <li><strong>Automate Marketing Workflows</strong> – Eliminate repetitive tasks, automate routine processes, and reduce manual administrative work.</li>
    
    <li><strong>Centralize Client Management</strong> – Manage client accounts, projects, communications, deliverables, and activities through a unified platform.</li>
    
    <li><strong>Streamline Campaign Management</strong> – Organize marketing campaigns, track deliverables, monitor progress, and manage multiple client campaigns efficiently.</li>
    
    <li><strong>Automate Performance Reporting</strong> – Consolidate marketing data and generate reports without manually collecting information from multiple platforms.</li>
    
    <li><strong>Improve Lead Management</strong> – Automate lead capture, follow-ups, client inquiries, and sales pipeline management.</li>
    
    <li><strong>Leverage AI</strong> – Introduce AI-powered content workflows, intelligent data analysis, automated insights, and smarter business processes.</li>
    
    <li><strong>Integrate Existing Platforms</strong> – Connect your CRM, marketing tools, analytics platforms, and other business applications to eliminate disconnected workflows.</li>
</ul>

<p><strong>Modernize Your Agency Without Disrupting Your Operations.</strong></p>

<p>We understand that your agency cannot simply pause client campaigns and ongoing projects while transitioning to new technology. That''s why we take a gradual, well-planned modernization approach that allows your team to continue serving clients while your internal systems and workflows evolve.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern business technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your technology should help your agency serve more clients, operate more efficiently, and scale without continuously increasing administrative overhead.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore whether there are opportunities to automate your agency''s workflows, streamline client management, and build software that supports your business as it grows.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('food-beverage-manufacturing', 'Food & Beverage Manufacturing', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the food and beverage products your company manufactures.</p>

<p>It got me wondering: Are you still relying on spreadsheets, paper-based records, manual data entry, or disconnected applications to manage production schedules, raw materials, ingredient inventory, batch records, and day-to-day manufacturing operations?</p>

<p>Are some of your critical business processes still running on outdated ERP systems or legacy applications that make it difficult to monitor production costs, track ingredients, manage expiration dates, maintain product traceability, and get real-time visibility into your operations?</p>

<p>These are common challenges among growing food and beverage manufacturers, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help food and beverage manufacturers modernize their operations through custom-built manufacturing ERP solutions, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your manufacturing business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Production Management</strong> – Streamline production planning, manufacturing schedules, work orders, recipes, formulations, and production tracking.</li>

    <li><strong>Improve Raw Material and Inventory Management</strong> – Monitor ingredients, packaging materials, finished goods, stock movements, and inventory levels across multiple storage locations.</li>

    <li><strong>Implement Batch and Lot Traceability</strong> – Track raw materials, production batches, ingredient usage, and finished products to improve product traceability and accountability.</li>

    <li><strong>Improve Quality Control</strong> – Organize quality inspections, production checks, compliance records, and product quality documentation throughout the manufacturing process.</li>

    <li><strong>Manage Expiration Dates and Shelf Life</strong> – Monitor product expiration dates, ingredient shelf life, stock rotation, and inventory movements to help minimize waste.</li>

    <li><strong>Improve Production Cost Visibility</strong> – Track ingredient costs, labor, overhead, and actual production expenses against estimates and budgets.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent workflows, automated document processing, production insights, demand forecasting, and AI-powered operational reporting.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your manufacturing ERP, accounting applications, purchasing systems, warehouse platforms, and other business tools to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Manufacturing Operations.</strong></p>

<p>We understand that food and beverage manufacturing operations cannot simply stop while transitioning to new technology. Production schedules, ingredient deliveries, inventory movements, quality inspections, and customer orders must continue without interruption.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern manufacturing technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your manufacturing software should adapt to your production processes and business requirements, not force your company to change the way it operates.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline production management, improve ingredient and inventory tracking, strengthen batch traceability, and modernize existing manufacturing operations.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('healthcare-administration', 'Healthcare Administration', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the healthcare services your organization provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, paper-based records, manual data entry, or disconnected applications to manage patient registration, appointment scheduling, billing, and day-to-day administrative operations?</p>

<p>Are some of your critical administrative processes still running on outdated healthcare management systems or legacy applications that make it difficult to coordinate operations, maintain accurate records, and get a clear picture of your organization''s performance?</p>

<p>These are common challenges among growing healthcare organizations, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help healthcare organizations modernize their administrative operations through custom-built healthcare management systems, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your healthcare organization actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Patient Administration</strong> – Streamline patient registration, demographic records, patient intake, and administrative workflows.</li>

    <li><strong>Automate Appointment Scheduling</strong> – Simplify appointment booking, scheduling, reminders, cancellations, and provider availability management.</li>

    <li><strong>Improve Billing and Payment Management</strong> – Streamline billing workflows, payment tracking, claims administration, and financial reporting.</li>

    <li><strong>Centralize Healthcare Information</strong> – Organize administrative records, documents, patient communications, and operational information through a unified platform.</li>

    <li><strong>Automate Administrative Workflows</strong> – Reduce repetitive data entry, paperwork, approval processes, and time-consuming administrative tasks.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent document processing, administrative workflow automation, automated information extraction, and AI-powered operational insights.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect scheduling platforms, billing applications, electronic health record systems, accounting software, and other business applications to reduce disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Healthcare Operations.</strong></p>

<p>We understand that healthcare organizations cannot simply stop serving patients while transitioning to new technology. Patient appointments, administrative activities, billing operations, and essential services must continue without interruption.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your organization to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern healthcare administration technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your healthcare software should adapt to your organization''s workflows, not force your team to change the way it operates.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline administrative operations, improve patient administration, automate repetitive workflows, and modernize existing business systems.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('professional-services', 'Professional Services', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the professional services your company provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual data entry, emails, or disconnected applications to manage client relationships, projects, service delivery, billing, and day-to-day business operations?</p>

<p>Are some of your critical business processes still running on outdated practice management systems or legacy applications that make it difficult to track project progress, manage client information, monitor billable hours, and maintain operational visibility?</p>

<p>These are common challenges among growing professional services firms, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help professional services companies modernize their operations through custom-built business management systems, workflow automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your professional services business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Client Management</strong> – Centralize client profiles, engagement history, communications, documents, and service records.</li>

    <li><strong>Streamline Project and Engagement Management</strong> – Organize projects, assignments, deadlines, deliverables, and team responsibilities through a unified platform.</li>

    <li><strong>Automate Billing and Invoicing</strong> – Simplify time tracking, billable hours, expense management, invoicing, and payment monitoring.</li>

    <li><strong>Improve Document Management</strong> – Centralize contracts, proposals, reports, client files, and other important business documents.</li>

    <li><strong>Automate Administrative Workflows</strong> – Reduce repetitive tasks involving client onboarding, approvals, notifications, follow-ups, and internal processes.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent document processing, automated information extraction, AI-powered reporting, and smarter business workflows.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your CRM, accounting applications, project management tools, and other business systems to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Business Operations.</strong></p>

<p>We understand that professional services firms cannot simply stop serving clients, managing engagements, or delivering projects while transitioning to new technology.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern business technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your business software should adapt to the way your firm operates, not force your team to change the way they work.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline client management, automate administrative processes, improve project visibility, and modernize existing business operations.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('property-management', 'Property Management', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the property management services your company provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual data entry, emails, or disconnected applications to manage properties, tenant records, lease agreements, rent collection, and maintenance requests?</p>

<p>Are some of your critical business processes still running on outdated property management software or legacy systems that make it difficult to monitor property performance, track rental payments, coordinate maintenance activities, and maintain visibility across multiple properties?</p>

<p>These are common challenges among growing property management companies, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help property management companies modernize their operations through custom-built property management systems, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your property management business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Property Management</strong> – Centralize property portfolios, unit information, occupancy records, ownership details, and property performance data.</li>

    <li><strong>Streamline Tenant Management</strong> – Manage tenant profiles, applications, lease agreements, renewals, communications, and tenant history through a unified platform.</li>

    <li><strong>Automate Rent Collection and Billing</strong> – Track rental payments, outstanding balances, recurring charges, deposits, and payment histories.</li>

    <li><strong>Improve Maintenance Management</strong> – Organize maintenance requests, work orders, service schedules, vendor assignments, and repair tracking.</li>

    <li><strong>Centralize Financial Reporting</strong> – Monitor rental income, operating expenses, property-level profitability, and financial performance.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent document processing, automated tenant communications, predictive maintenance insights, and AI-powered operational reporting.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your property management platform with accounting applications, payment gateways, CRM systems, and other business tools to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Property Management Operations.</strong></p>

<p>We understand that managing properties cannot simply stop while transitioning to new technology. Tenant concerns, rental payments, lease renewals, maintenance requests, and daily property operations must continue without interruption.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern property management technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your property management software should adapt to your business processes, not force your team to change the way it operates.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline property operations, improve tenant management, automate administrative tasks, and gain better visibility across your property portfolio.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('transportation-logistics', 'Transportation & Logistics', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the transportation and logistics services your company provides.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual data entry, phone calls, or disconnected applications to manage fleet operations, dispatching, shipments, deliveries, and day-to-day logistics activities?</p>

<p>Are some of your critical business processes still running on outdated transportation management systems or legacy applications that make it difficult to monitor vehicles, track shipments, coordinate deliveries, and get real-time visibility into your operations?</p>

<p>These are common challenges among growing transportation and logistics companies, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help transportation and logistics businesses modernize their operations through custom-built transportation management systems, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your logistics business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Fleet Management</strong> – Monitor vehicle assignments, maintenance schedules, operating expenses, fleet availability, and vehicle utilization.</li>

    <li><strong>Streamline Dispatch Operations</strong> – Automate driver assignments, dispatch scheduling, delivery coordination, and job allocation.</li>

    <li><strong>Improve Shipment Tracking</strong> – Centralize shipment information, monitor delivery progress, and provide better visibility into shipment status and fulfillment.</li>

    <li><strong>Optimize Route Planning</strong> – Improve delivery coordination, reduce unnecessary travel, and identify opportunities to optimize transportation costs.</li>

    <li><strong>Automate Logistics Documentation</strong> – Streamline delivery receipts, bills of lading, invoices, proof of delivery, and other operational documents.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent workflows, predictive maintenance insights, automated document processing, and AI-powered operational reporting.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your transportation management system, accounting applications, CRM, GPS tracking platforms, and other business tools to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Logistics Operations.</strong></p>

<p>We understand that transportation and logistics businesses cannot simply stop dispatching vehicles, coordinating deliveries, tracking shipments, or serving customers while transitioning to new technology.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern transportation and logistics technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your logistics software should adapt to your business operations, not force your company to change the way it works.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline fleet management, improve dispatch operations, gain better shipment visibility, and eliminate inefficient manual processes.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000)),
  ('wholesale-distribution', 'Wholesale & Distribution', '<p>Hi {{firstName}},</p>

<p>I recently visited your website and took some time to learn more about <strong>{{companyName}}</strong> and the wholesale and distribution operations your company handles.</p>

<p>It got me wondering: Are you still relying on spreadsheets, manual data entry, or disconnected applications to manage inventory, purchase orders, sales orders, warehouse operations, and daily distribution activities?</p>

<p>Are some of your critical business processes still running on outdated ERP systems or legacy applications that make it difficult to maintain accurate inventory records, monitor stock movements, and get real-time visibility into your business operations?</p>

<p>These are common challenges among growing wholesale and distribution companies, and they''re exactly where we can help.</p>

<p>At <strong>Sabertooth Software Labs</strong>, we help wholesale and distribution businesses modernize their operations through custom-built ERP solutions, business process automation, system integrations, and AI-driven software solutions.</p>

<p>We develop solutions designed around how your distribution business actually operates, helping you:</p>

<ul>
    <li><strong>Modernize Inventory Management</strong> – Track stock levels, product movements, inventory adjustments, and availability across multiple warehouses and locations.</li>

    <li><strong>Streamline Order Processing</strong> – Automate sales orders, purchase orders, order fulfillment, invoicing, and customer transactions.</li>

    <li><strong>Improve Warehouse Operations</strong> – Organize receiving, picking, packing, shipping, and inventory transfers to improve warehouse efficiency.</li>

    <li><strong>Optimize Purchasing and Procurement</strong> – Improve supplier management, purchasing workflows, replenishment, and stock forecasting.</li>

    <li><strong>Gain Better Business Visibility</strong> – Monitor sales performance, inventory valuation, product profitability, operating costs, and business performance through centralized reporting.</li>

    <li><strong>Leverage AI</strong> – Introduce intelligent workflows, automated document processing, demand forecasting, and AI-powered business insights.</li>

    <li><strong>Integrate Existing Systems</strong> – Connect your ERP, accounting applications, CRM, e-commerce platforms, and other business tools to eliminate disconnected workflows and duplicate data entry.</li>
</ul>

<p><strong>Modernize Without Disrupting Your Distribution Operations.</strong></p>

<p>We understand that your business cannot simply stop processing customer orders, receiving shipments, managing inventory, or fulfilling deliveries while transitioning to new technology.</p>

<p>That''s why we take a gradual, well-planned modernization approach that allows your business to transition from existing processes and legacy systems into modern solutions while keeping your day-to-day operations running.</p>

<p><strong>Why Work With Sabertooth Software Labs?</strong></p>

<p><strong>1. You Own Your Source Code. No Vendor Lock-in.</strong></p>

<p>When we build your software, you own the source code and intellectual property as agreed in our engagement. You''re not locked into depending on a single software agency to maintain or improve your system. You can continue development with your internal IT team, hire another developer, transfer the project to another agency, or leverage AI-assisted development tools to maintain and extend your software. Your technology should remain an asset you control.</p>

<p><strong>2. Faster Delivery Without the Million-Dollar Price Tag.</strong></p>

<p>Traditional custom software development projects can take 6–12 months or longer and often require substantial investments. By combining experienced software engineering with modern development tools and AI-assisted workflows, we aim to deliver appropriately scoped solutions in as little as <strong>2–4 months</strong>, depending on project requirements and complexity.</p>

<p>You get modern business technology, faster delivery, and a more practical investment without the traditional enterprise price tag.</p>

<p>We believe your distribution management software should adapt to your business processes, not force your company to change the way it operates.</p>

<p><strong>Would you be open to a quick conversation?</strong> We''d love to explore how we could help {{companyName}} streamline inventory management, improve order processing, modernize warehouse operations, and eliminate inefficient manual processes.</p>

<p>No pressure or commitment. Just a conversation.</p>', (CAST(strftime('%s', 'now') AS integer) * 1000), (CAST(strftime('%s', 'now') AS integer) * 1000));

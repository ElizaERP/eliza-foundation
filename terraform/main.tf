# =====================================================================
# ELIZA Foundation — Terraform main
# =====================================================================
# Provisiona la infraestructura base en OCI:
#   - VCN con 3 subredes privadas (apps, data, bastion) + 1 pública (LB)
#   - Internet Gateway + NAT Gateway + Service Gateway
#   - OKE cluster + node pool
#   - PostgreSQL managed (OCI Database with PostgreSQL)
#   - Redis cluster (OCI Cache)
#   - Vault + KMS key
#   - OCI Container Registry repository
#
# IMPORTANTE: la primera vez que ejecutes, COMENTA los módulos pesados
# (postgres, redis, oke) y aplica primero VCN/Vault. Después ve agregando.

terraform {
  required_version = ">= 1.5"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

locals {
  app_name     = "eliza"
  project_name = "${local.app_name}-${var.environment}"
  common_tags = {
    Project     = "ELIZA"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# ---------------------------------------------------------------------
# Availability Domains (necesario para placement)
# ---------------------------------------------------------------------
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# ---------------------------------------------------------------------
# VCN principal
# ---------------------------------------------------------------------
resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${local.project_name}-vcn"
  dns_label      = "eliza${var.environment}"
  freeform_tags  = local.common_tags
}

# ---------- Gateways ----------
resource "oci_core_internet_gateway" "ig" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.project_name}-ig"
}

resource "oci_core_nat_gateway" "ng" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.project_name}-ng"
}

resource "oci_core_service_gateway" "sg" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.project_name}-sg"
  services {
    service_id = data.oci_core_services.all_services.services[0].id
  }
}

data "oci_core_services" "all_services" {
  filter {
    name   = "name"
    values = ["All .* Services In Oracle Services Network"]
    regex  = true
  }
}

# ---------- Route Tables ----------
resource "oci_core_route_table" "public_rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.project_name}-public-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.ig.id
  }
}

resource "oci_core_route_table" "private_rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.project_name}-private-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_nat_gateway.ng.id
  }
  route_rules {
    destination       = data.oci_core_services.all_services.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
    network_entity_id = oci_core_service_gateway.sg.id
  }
}

# ---------- Subnets ----------
resource "oci_core_subnet" "public_lb" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 0)   # 10.0.0.0/24
  display_name               = "${local.project_name}-public-lb"
  dns_label                  = "publb"
  route_table_id             = oci_core_route_table.public_rt.id
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_subnet" "apps_private" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 10)  # 10.0.10.0/24
  display_name               = "${local.project_name}-apps-private"
  dns_label                  = "apps"
  route_table_id             = oci_core_route_table.private_rt.id
  prohibit_public_ip_on_vnic = true
}

resource "oci_core_subnet" "data_private" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 20)  # 10.0.20.0/24
  display_name               = "${local.project_name}-data-private"
  dns_label                  = "data"
  route_table_id             = oci_core_route_table.private_rt.id
  prohibit_public_ip_on_vnic = true
}

# ---------------------------------------------------------------------
# Vault + KMS (para guardar secretos)
# ---------------------------------------------------------------------
resource "oci_kms_vault" "main" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.project_name}-vault"
  vault_type     = "DEFAULT"
  freeform_tags  = local.common_tags
}

resource "oci_kms_key" "master" {
  compartment_id      = var.compartment_ocid
  display_name        = "${local.project_name}-master-key"
  management_endpoint = oci_kms_vault.main.management_endpoint
  key_shape {
    algorithm = "AES"
    length    = 32
  }
  protection_mode = "SOFTWARE"
}

# ---------------------------------------------------------------------
# OCI Container Registry
# ---------------------------------------------------------------------
resource "oci_artifacts_container_repository" "app" {
  compartment_id = var.compartment_ocid
  display_name   = "eliza-foundation"
  is_public      = false
}

# ---------------------------------------------------------------------
# OKE Cluster
# (Comentar este bloque en el primer apply; descomenta cuando VCN esté ready)
# ---------------------------------------------------------------------
resource "oci_containerengine_cluster" "main" {
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.oke_kubernetes_version
  name               = "${local.project_name}-oke"
  vcn_id             = oci_core_vcn.main.id

  endpoint_config {
    is_public_ip_enabled = true
    subnet_id            = oci_core_subnet.public_lb.id
  }

  options {
    service_lb_subnet_ids = [oci_core_subnet.public_lb.id]
    kubernetes_network_config {
      pods_cidr     = "10.244.0.0/16"
      services_cidr = "10.96.0.0/16"
    }
  }
  freeform_tags = local.common_tags
}

data "oci_core_images" "oracle_linux" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = var.oke_node_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_containerengine_node_pool" "main" {
  cluster_id         = oci_containerengine_cluster.main.id
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.oke_kubernetes_version
  name               = "${local.project_name}-pool"
  node_shape         = var.oke_node_shape

  node_shape_config {
    ocpus         = var.oke_node_ocpus
    memory_in_gbs = var.oke_node_memory_gb
  }

  node_source_details {
    source_type = "IMAGE"
    image_id    = data.oci_core_images.oracle_linux.images[0].id
  }

  node_config_details {
    size = var.oke_node_pool_size
    dynamic "placement_configs" {
      for_each = data.oci_identity_availability_domains.ads.availability_domains
      content {
        availability_domain = placement_configs.value.name
        subnet_id           = oci_core_subnet.apps_private.id
      }
    }
  }
  freeform_tags = local.common_tags
}

# ---------------------------------------------------------------------
# PostgreSQL managed
# ---------------------------------------------------------------------
resource "oci_psql_db_system" "main" {
  compartment_id    = var.compartment_ocid
  display_name      = "${local.project_name}-postgres"
  db_version        = "16"
  instance_count    = var.postgres_instance_count
  shape             = var.postgres_shape

  storage_details {
    is_regionally_durable = true
    system_type           = "OCI_OPTIMIZED_STORAGE"
    iops                  = 10000
  }

  network_details {
    subnet_id = oci_core_subnet.data_private.id
  }

  credentials {
    username = "postgres"
    password_details {
      password_type = "PLAIN_TEXT"
      password      = var.postgres_admin_password
    }
  }

  instances_details {
    description = "Primary"
  }
  freeform_tags = local.common_tags
}

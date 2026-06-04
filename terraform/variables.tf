# =====================================================================
# ELIZA Foundation — Terraform variables
# =====================================================================
# Reemplazables vía -var-file=staging.tfvars (o prod.tfvars).

variable "tenancy_ocid" {
  description = "OCID del tenancy de OCI"
  type        = string
}

variable "user_ocid" {
  description = "OCID del usuario que ejecuta Terraform"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint de la API key del usuario"
  type        = string
}

variable "private_key_path" {
  description = "Ruta al archivo .pem de la API key"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "Región OCI (ej: us-ashburn-1, sa-saopaulo-1)"
  type        = string
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  description = "OCID del compartment donde se crearán los recursos"
  type        = string
}

variable "environment" {
  description = "Entorno (staging | production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment debe ser 'staging' o 'production'."
  }
}

variable "vcn_cidr" {
  description = "CIDR principal de la VCN"
  type        = string
  default     = "10.0.0.0/16"
}

variable "oke_kubernetes_version" {
  description = "Versión de Kubernetes en OKE"
  type        = string
  default     = "v1.30.1"
}

variable "oke_node_pool_size" {
  description = "Cantidad inicial de nodos en el pool"
  type        = number
  default     = 3
}

variable "oke_node_shape" {
  description = "Shape de los nodos worker"
  type        = string
  default     = "VM.Standard.E4.Flex"
}

variable "oke_node_ocpus" {
  description = "OCPUs por nodo worker"
  type        = number
  default     = 2
}

variable "oke_node_memory_gb" {
  description = "Memoria por nodo worker en GB"
  type        = number
  default     = 16
}

variable "postgres_shape" {
  description = "Shape del cluster PostgreSQL"
  type        = string
  default     = "VM.Standard.E4.Flex"
}

variable "postgres_ocpus" {
  description = "OCPUs por instancia de Postgres"
  type        = number
  default     = 2
}

variable "postgres_memory_gb" {
  description = "Memoria por instancia de Postgres"
  type        = number
  default     = 16
}

variable "postgres_instance_count" {
  description = "Cantidad de instancias PostgreSQL (HA con 3)"
  type        = number
  default     = 3
}

variable "postgres_admin_password" {
  description = "Password inicial para el rol 'postgres'. Almacenado en Vault tras provisioning."
  type        = string
  sensitive   = true
}

variable "redis_node_memory_gb" {
  description = "Memoria del nodo Redis"
  type        = number
  default     = 8
}

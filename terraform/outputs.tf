# =====================================================================
# Outputs — útiles para configurar la app después del provisioning
# =====================================================================

output "vcn_id" {
  description = "OCID de la VCN"
  value       = oci_core_vcn.main.id
}

output "apps_subnet_id" {
  description = "OCID de la subnet privada para apps"
  value       = oci_core_subnet.apps_private.id
}

output "data_subnet_id" {
  description = "OCID de la subnet privada para datos"
  value       = oci_core_subnet.data_private.id
}

output "vault_id" {
  description = "OCID del Vault — referenciado en k8s/03-external-secret.yaml"
  value       = oci_kms_vault.main.id
}

output "kms_key_id" {
  description = "OCID del KMS master key"
  value       = oci_kms_key.master.id
}

output "container_registry_repository" {
  description = "Path del repositorio OCIR"
  value       = oci_artifacts_container_repository.app.display_name
}

output "oke_cluster_id" {
  description = "OCID del cluster OKE — usar con `oci ce cluster create-kubeconfig`"
  value       = oci_containerengine_cluster.main.id
}

output "postgres_db_system_id" {
  description = "OCID del DB system PostgreSQL"
  value       = oci_psql_db_system.main.id
}

output "postgres_endpoint" {
  description = "Endpoint primario del PostgreSQL para construir DATABASE_URL"
  value       = try(oci_psql_db_system.main.instances[0].private_ip, "pending")
}

output "next_steps" {
  description = "Pasos siguientes tras el apply"
  value       = <<-EOT
    Infraestructura provisionada. Siguientes pasos:

    1. Conectar kubectl al cluster:
       oci ce cluster create-kubeconfig --cluster-id ${oci_containerengine_cluster.main.id} \
         --file ~/.kube/config --region ${var.region} --token-version 2.0.0

    2. Conectar al Postgres por bastion para crear roles (app_user, migration_user)
       y schemas (tenant, iam, audit, platform). Ver prisma/init/01_bootstrap.sql.

    3. Crear secretos en Vault:
       oci vault secret create-base64 --vault-id ${oci_kms_vault.main.id} ...

    4. Login en OCIR y push de la imagen:
       docker login ${var.region}.ocir.io -u <tenancy-namespace>/<user>
       docker push ${var.region}.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0

    5. Aplicar manifiestos k8s:
       kubectl apply -f ../k8s/
  EOT
}

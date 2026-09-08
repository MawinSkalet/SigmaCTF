variable "REGISTRY_USER" { default = "mawin82560" }
variable "TAG" { default = "v1" }
group "default" { targets = ["backend", "web", "web-ping-of-ohio", "pwn-sigma-overflow"] }
target "backend" {
  context = "."
  dockerfile = "apps/api/Dockerfile"
  tags = ["${REGISTRY_USER}/backend:${TAG}"]
  platforms = ["linux/amd64"]
}
target "web" {
  context = "."
  dockerfile = "apps/web/Dockerfile"
  tags = ["${REGISTRY_USER}/web:${TAG}"]
  platforms = ["linux/amd64"]
}
target "web-ping-of-ohio" {
  context = "challenges/web-ping-of-ohio"
  tags = ["${REGISTRY_USER}/web-ping-of-ohio:${TAG}"]
  platforms = ["linux/amd64"]
}
target "pwn-sigma-overflow" {
  context = "challenges/pwn-sigma-overflow"
  tags = ["${REGISTRY_USER}/pwn-sigma-overflow:${TAG}"]
  platforms = ["linux/amd64"]
}

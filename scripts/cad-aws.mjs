// Despliegue del motor CAD y del sandbox en AWS Lambda (Serverless Framework).
// Uso: npm run aws:<comando> [-- --stage dev|prod]   (por defecto prod)
//      node scripts/cad-aws.mjs <comando> [motor|sandbox] [--stage dev|prod]
//
// Comandos: deploy | info | logs | remove | claves
// El stage elige el archivo de variables (.env.dev, .env.prod), el stack de AWS
// (plexiacril-cad-<stage>) y los parámetros SSM (/plexiacril/<stage>/...).
// Variables (en .env.<stage> o en el entorno; las del entorno ganan):
//   CAD_AWS_STAGE             stage si no se pasa --stage (por defecto "prod")
//   CAD_AWS_REGION            región (por defecto "us-east-1")
//   CAD_AWS_PROFILE           perfil de AWS CLI (opcional; si no, el de AWS_PROFILE o el default)
//   CAD_SANDBOX_SUBNET_A/B    subredes PRIVADAS sin ruta a NAT/IGW (solo deploy/info/remove)
//   CAD_SANDBOX_SG            security group sin reglas de salida (solo deploy/info/remove)
// Detalles en cad/README.md, sección «Despliegue en AWS».
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../cad", import.meta.url));
const raiz = fileURLToPath(new URL("..", import.meta.url));

// --stage dev | --stage=dev, el resto son posicionales (comando y destino).
const posicionales = [];
let stageFlag;
const argumentos = process.argv.slice(2);
for (let i = 0; i < argumentos.length; i++) {
  const a = argumentos[i];
  if (a === "--stage") stageFlag = argumentos[++i];
  else if (a.startsWith("--stage=")) stageFlag = a.slice("--stage=".length);
  else posicionales.push(a);
}
const [comando, destino = "todo"] = posicionales;

const stage = stageFlag || process.env.CAD_AWS_STAGE || "prod";
if (!/^[a-z][a-z0-9-]*$/.test(stage)) fallar(`Stage inválido "${stage}": usa letras minúsculas, números y guiones (dev, prod).`);

const archivoEnv = `${raiz}.env.${stage}`;
if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv); // no pisa variables ya definidas
else console.log(`(sin .env.${stage}: se usan solo las variables del entorno)`);
console.log(`Stage: ${stage}`);

const region = process.env.CAD_AWS_REGION || "us-east-1";
if (process.env.CAD_AWS_PROFILE) process.env.AWS_PROFILE = process.env.CAD_AWS_PROFILE;

const FUNCIONES = ["motor", "sandbox"];
if (destino !== "todo" && !FUNCIONES.includes(destino)) fallar(`Destino desconocido "${destino}": usa motor o sandbox.`);

function fallar(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function correr(cmd, args, opciones = {}) {
  console.log(`\n$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", ...opciones });
  if (r.error) fallar(`No se pudo ejecutar ${cmd}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function sls(args) {
  correr("npx", ["--yes", "serverless@4", ...args, "--stage", stage, "--region", region]);
}

function paramsVpc() {
  const a = process.env.CAD_SANDBOX_SUBNET_A;
  const b = process.env.CAD_SANDBOX_SUBNET_B;
  const sg = process.env.CAD_SANDBOX_SG;
  if (!a || !b || !sg) {
    fallar("Faltan CAD_SANDBOX_SUBNET_A, CAD_SANDBOX_SUBNET_B y CAD_SANDBOX_SG (subredes privadas sin NAT y security group sin salida).");
  }
  return [`--param=sandboxSubnetIdA=${a}`, `--param=sandboxSubnetIdB=${b}`, `--param=sandboxSecurityGroupId=${sg}`];
}

function aws(args) {
  correr("aws", [...args, "--region", region]);
}

switch (comando) {
  case "deploy": {
    // Todo: crea/actualiza el stack. Una sola función: construye y sube solo esa imagen.
    if (destino === "todo") sls(["deploy", ...paramsVpc()]);
    else sls(["deploy", "function", "--function", destino, ...paramsVpc()]);
    sls(["info"]);
    break;
  }
  case "info":
    sls(["info", ...paramsVpc()]);
    break;
  case "logs":
    if (destino === "todo") fallar("Indica la función: logs motor | logs sandbox.");
    sls(["logs", "--function", destino, "--tail"]);
    break;
  case "remove":
    sls(["remove", ...paramsVpc()]);
    break;
  case "claves": {
    // Crea los parámetros SSM que lee serverless.yml. No pisa los que ya existen.
    for (const nombre of ["CAD_API_KEY", "CAD_SANDBOX_API_KEY"]) {
      const ruta = `/plexiacril/${stage}/${nombre}`;
      const existe = spawnSync("aws", ["ssm", "get-parameter", "--name", ruta, "--region", region], { encoding: "utf8" });
      if (existe.error) fallar(`No se pudo ejecutar aws: ${existe.error.message}`);
      if (existe.status === 0) {
        console.log(`= ${ruta} ya existe; no se toca (rotar: aws ssm put-parameter --overwrite y redesplegar).`);
        continue;
      }
      // Solo se crea si AWS dice que no existe; cualquier otro error (credenciales, permisos) corta aquí.
      if (!/ParameterNotFound/.test(existe.stderr)) fallar(`No se pudo consultar ${ruta}:\n${existe.stderr.trim()}`);
      const crear = spawnSync(
        "aws",
        ["ssm", "put-parameter", "--type", "SecureString", "--name", ruta, "--value", randomBytes(32).toString("hex"), "--region", region],
        { encoding: "utf8" },
      );
      if (crear.status !== 0) fallar(`No se pudo crear ${ruta}:\n${(crear.stderr || "").trim()}`);
      console.log(`+ ${ruta} creado. Ver el valor: aws ssm get-parameter --with-decryption --name ${ruta} --query Parameter.Value --output text`);
    }
    break;
  }
  default:
    fallar("Comando: deploy | info | logs | remove | claves  (opcional: motor | sandbox)");
}

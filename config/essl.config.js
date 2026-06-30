import sql from "mssql";

const biometricConfig = {
    user: process.env.BIOMETRIC_DB_USER,
    password: process.env.BIOMETRIC_DB_PASSWORD,
    server: process.env.BIOMETRIC_DB_HOST,
    database: process.env.BIOMETRIC_DB_NAME,
    port: Number(process.env.BIOMETRIC_DB_PORT),

    options: {
        encrypt: process.env.BIOMETRIC_DB_ENCRYPT === "true",
        trustServerCertificate:
            process.env.BIOMETRIC_DB_TRUST_CERT === "true",
    },
};

export async function biometricDB() {
    return await sql.connect(biometricConfig);
}
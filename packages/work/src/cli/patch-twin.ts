// patch-twin.ts — atualiza dados do candidato no SQLite
import dotenv from 'dotenv';
import path from 'path';
import { TwinStore } from '../twin/candidate-twin.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

async function main() {
  const store = await TwinStore.create();

  // Lê o twin atual e mescla os novos campos manualmente
  const current = store.get();
  current.identity.cpf = '205.377.158-51';
  current.learning.education = [
    {
      institution: 'USP / Univesp',
      degree: 'Graduação',
      course: 'Tecnologia da Informação',
      year: 2025,
    },
  ];
  store.save_twin(current);

  const twin = store.get(); // relê do disco para confirmar
  console.log('[Twin] Dados atualizados:');
  console.log('  CPF:         ', (twin.identity as unknown as Record<string,string>).cpf);
  console.log('  Formação:    ', twin.learning.education?.[0]?.institution);
  console.log('  Grau:        ', twin.learning.education?.[0]?.degree);
  console.log('  Curso:       ', twin.learning.education?.[0]?.course);
  console.log('  Ano:         ', twin.learning.education?.[0]?.year);

  store.close();
  console.log('\n[Twin] Persistido em .vraxia-work/work.db ✅');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });

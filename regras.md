rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // E-mails com acesso de administrador (cadastre o mesmo e-mail em Authentication → Users)
    function emailsAdmin() {
      return ['rasistema25@gmail.com'];
    }

    function isAdmin() {
      return request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.lower() in emailsAdmin();
    }

    match /produtos/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /categorias/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /cupons/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /configuracoes/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /fretes/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Consulta pública do cliente: só por código (get). Listar é do admin.
    // Não guarda telefone nem endereço.
    match /acompanhamento/{codigo} {
      allow get: if true;
      allow list: if isAdmin();
      allow create: if isAdmin()
                    || (request.resource.data.status == 'novo'
                        && request.resource.data.codigo == codigo
                        && codigo.size() >= 8 && codigo.size() <= 12);
      allow update, delete: if isAdmin();
    }

    // Gestão interna (PDV, caixa e financeiro): só administrador
    match /vendas/{doc} {
      allow read, write: if isAdmin();
    }

    match /caixas/{doc} {
      allow read, write: if isAdmin();
    }

    match /contas/{doc} {
      allow read, write: if isAdmin();
    }

    match /movimentos/{doc} {
      allow read, write: if isAdmin();
    }

    match /clientes/{doc} {
      allow read, write: if isAdmin();
    }

    match /pedidos/{doc} {
      allow create: if request.resource.data.codigo == doc
                    && request.resource.data.keys().hasAll(['itens', 'total', 'tipo', 'cliente', 'status', 'codigo'])
                    && request.resource.data.status == 'novo'
                    && request.resource.data.itens is list
                    && request.resource.data.itens.size() > 0
                    && request.resource.data.itens.size() <= 50
                    && request.resource.data.total is number
                    && request.resource.data.total >= 0;
      allow read, update, delete: if isAdmin();
    }
  }
}

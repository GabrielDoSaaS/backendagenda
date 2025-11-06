const axios = require('axios');


const find= async () => {


await axios.post('http://localhost:3000/addProfessor', JSON.stringify({name:"Gabriel", description: "descrição", email:"gabrield3vsilva@gmail.com", password:"1981Abcd.", specialties: [], picture:"teste", pix:"11985058988"}), {headers:{"Content-Type": "application/json"}})
.then((response)=>console.log(response.data));

}

find()
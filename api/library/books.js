import { verifyFirebaseBearerToken } from "../_lib/firebaseAuth.js";
import { getFirebaseAdminFirestore, listUserBooks } from "../_lib/firestore.js";

export function createBooksHandler({verifyToken=verifyFirebaseBearerToken,getDb=getFirebaseAdminFirestore,listBooks=listUserBooks}={}) {
 return async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const identity=await verifyToken(req);
  if(!identity.ok)return res.status(identity.status).json({error:identity.error});
  try {
   const result=await listBooks({db:await getDb(),uid:identity.user.uid,limit:req.query?.limit});
   return res.status(200).json(result);
  } catch(error) {
   if(error instanceof TypeError)return res.status(400).json({error:"Invalid request"});
   return res.status(503).json({error:"Library service unavailable"});
  }
 };
}
export default createBooksHandler();

import { getSession, withApiAuthRequired } from "@auth0/nextjs-auth0";
import { Configuration, OpenAIApi } from "openai";
import clientPromise from "../../lib/mongodb";

export default withApiAuthRequired(async function handler(req, res) {
  const { user } = await getSession(req, res);
  const client = await clientPromise;
  const db = client.db("BLOGAI");
  const userProfile = await db.collection("users").findOne({
    auth0Id: user.sub,
  });

  if (!userProfile.availableTokens) return res.status(403);

  const config = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(config);

  const { topic, keywords } = req.body;
  if (!topic || !keywords) return res.status(422);
  if (topic.length > 100 || keywords > 100) return res.status(422);

  try {
    const postContentResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "You are a blog post generator",
        },
        {
          role: "user",
          content: `Write a long and detailed SEO-friendly blog post about: ${topic}, that target the following comma-seperated keywords: ${keywords}.
          The content should be formatted in SEO-friendly HTML,
          only use the following HTML tags: p,h1,h2,h3,h4,h5,h6,strong,li,ul,ol,i`,
        },
      ],
    });

    const postContent =
      postContentResponse.data.choices[0]?.message?.content || "";

    const titleResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "You are a blog post generator",
        },
        {
          role: "assistant",
          content: postContent,
        },
        {
          role: "user",
          content:
            "Generate appropriate title tag text for the above blog post, only use the following HTML tags: p,h1,h2,h3,h4,h5,h6,strong,li,ul,ol,i`",
        },
      ],
    });

    const metaDescriptionResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "You are a blog post generator",
        },
        {
          role: "assistant",
          content: postContent,
        },
        {
          role: "user",
          content:
            "Generate SEO-friendly meta description content for the above blog post, only use the following HTML tags: p,h1,h2,h3,h4,h5,h6,strong,li,ul,ol,i`",
        },
      ],
    });

    const title = titleResponse.data.choices[0]?.message?.content || "";
    const metaDescription =
      metaDescriptionResponse.data.choices[0]?.message?.content || "";

    await db.collection("users").updateOne(
      {
        auth0Id: user.sub,
      },
      {
        $inc: {
          availableTokens: -1,
        },
      }
    );

    const post = await db.collection("posts").insertOne({
      postContent,
      title,
      metaDescription,
      topic,
      keywords,
      userId: userProfile._id,
      created: new Date(),
    });

    res.status(200).json({
      postId: post.insertedId,
    });
  } catch (error) {
    res.status(500).json({ msg: error });
    console.log("[generatePost ERROR]: ", error);
    return;
  }
});

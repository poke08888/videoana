const ContentPage = require("../../models/contentPage.model");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

exports.createContentPage = async (req, res) => {
  try {
    const { title, description, name, icon } = req.body;

    if (!name || !title || !description) {
      if (icon) {
        await deleteFromStorage(icon);
      }

      return res.status(400).json({
        status: false,
        message: "Name, title, and description are required.",
      });
    }

    const nameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!nameRegex.test(name)) {
      if (icon) {
        await deleteFromStorage(icon);
      }

      return res.status(400).json({
        status: false,
        message: "The 'name' field must not contain spaces or special characters.",
      });
    }

    const existingContentPage = await ContentPage.findOne({ name });
    if (existingContentPage) {
      if (icon) {
        await deleteFromStorage(icon);
      }

      return res.status(409).json({
        status: false,
        message: "Content Page with the same name already exists.",
      });
    }

    const newContentPage = new ContentPage({
      name,
      title,
      description,
      icon: icon || "",
    });

    await newContentPage.save();

    return res.status(201).json({
      status: true,
      message: "Content Page created successfully.",
      data: newContentPage,
    });
  } catch (error) {
    if (icon) {
      await deleteFromStorage(icon);
    }
    console.error(error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.updateContentPage = async (req, res) => {
  try {
    const { contentId } = req.query;
    const { title, description, icon } = req.body;

    if (!contentId) {
      if (icon) {
        await deleteFromStorage(icon);
      }
      return res.status(400).json({ status: false, message: "Content ID is required." });
    }

    const contentPage = await ContentPage.findById(contentId);
    if (!contentPage) {
      if (icon) {
        await deleteFromStorage(icon);
      }

      return res.status(404).json({ status: false, message: "Content Page not found." });
    }

    if (title) contentPage.title = title;
    if (description) contentPage.description = description;
    if (icon) {
      if (contentPage.icon) {
        await deleteFromStorage(contentPage.icon);
      }

      contentPage.icon = icon;
    }

    await contentPage.save();

    return res.status(200).json({
      status: true,
      message: "Content Page updated successfully.",
      data: contentPage,
    });
  } catch (error) {
    if (icon) {
      await deleteFromStorage(icon);
    }

    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getAllContentPages = async (req, res) => {
  try {
    const contentPages = await ContentPage.find().sort({ createdAt: -1 }).lean();

    return res.status(200).json({ status: true, data: contentPages });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getContentPageByName = async (req, res) => {
  try {
    const { name } = req.params;

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        status: false,
        message: "Invalid name parameter.",
      });
    }

    const contentPage = await ContentPage.findOne({ name });
    if (!contentPage) {
      return res.status(404).json({ status: false, message: "Content Page not found." });
    }

    return res.status(200).json({ status: true, data: contentPage });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.deleteContentPage = async (req, res) => {
  try {
    const { contentId } = req.query;
    const contentPage = await ContentPage.findByIdAndDelete(contentId);

    if (!contentPage) {
      return res.status(404).json({ status: false, message: "Content Page not found." });
    }

    if (contentPage.icon) {
      await deleteFromStorage(contentPage.icon);
    }

    return res.status(200).json({
      status: true,
      message: "Content Page deleted successfully.",
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
